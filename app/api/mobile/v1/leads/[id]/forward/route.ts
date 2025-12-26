// app/api/mobile/v1/leads/[id]/forward/route.ts
import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function leadIdFromCtxOrUrl(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<string> {
  try {
    const p = await ctx.params;
    const fromCtx = typeof p?.id === "string" ? p.id.trim() : "";
    if (fromCtx) return fromCtx;
  } catch {
    // ignore
  }

  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("leads");
    if (idx >= 0 && parts[idx + 1]) return String(parts[idx + 1]).trim();
  } catch {
    // ignore
  }
  return "";
}

function getIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) return xff.split(",")[0]?.trim() || null;
  const xri = req.headers.get("x-real-ip")?.trim();
  return xri || null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  if (!tenantRes.ok) {
    return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
  }

  const leadId = await leadIdFromCtxOrUrl(req, ctx);
  if (!leadId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");
  }

  // leak-safe lead check (must belong to tenant)
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId: tenantRes.tenant.id },
    select: { id: true, formId: true, groupId: true, isDeleted: true },
  });

  if (!lead) {
    return jsonError(req, 404, "NOT_FOUND", "Lead not found.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "BAD_JSON", "Invalid JSON body.");
  }

  if (!isRecord(body)) {
    return jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.");
  }

  const recipientListId = isNonEmptyString(body.recipientListId)
    ? body.recipientListId.trim()
    : null;

  const emailsRaw = body.emails;
  const emailsInput: string[] =
    Array.isArray(emailsRaw) ? emailsRaw.filter((x) => typeof x === "string") : [];

  const subject = isNonEmptyString(body.subject) ? body.subject.trim().slice(0, 200) : null;
  const message = isNonEmptyString(body.message) ? body.message.trim().slice(0, 5000) : null;

  if (!recipientListId && emailsInput.length === 0) {
    return jsonError(
      req,
      400,
      "RECIPIENTS_REQUIRED",
      'Provide "recipientListId" or "emails[]".'
    );
  }

  // Resolve recipients
  let sentTo: string[] = [];
  const mode: "stub" = "stub";

  if (recipientListId) {
    const list = await prisma.recipientList.findFirst({
      where: { id: recipientListId, tenantId: tenantRes.tenant.id },
      select: { id: true, isActive: true },
    });

    if (!list) {
      return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");
    }

    const entries = await prisma.recipientListEntry.findMany({
      where: { tenantId: tenantRes.tenant.id, recipientListId: list.id },
      select: { email: true },
    });

    sentTo = entries.map((e) => normalizeEmail(e.email)).filter((e) => looksLikeEmail(e));
  } else {
    sentTo = emailsInput.map((e) => normalizeEmail(e)).filter((e) => looksLikeEmail(e));
  }

  // de-dupe + cap (MVP safety)
  sentTo = Array.from(new Set(sentTo)).slice(0, 100);

  if (sentTo.length === 0) {
    return jsonError(req, 400, "NO_RECIPIENTS", "No valid recipient emails found.");
  }

  // AuditEvent (best effort)
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: tenantRes.tenant.id,
        actorType: "SYSTEM",
        action: "LEAD_FORWARDED",
        entityType: "LEAD",
        entityId: lead.id,
        ip: getIp(req),
        userAgent: req.headers.get("user-agent"),
        meta: {
          mode,
          sentTo,
          recipientListId: recipientListId ?? null,
          subject: subject ?? null,
          messagePreview: message ? message.slice(0, 200) : null,
          tenantResolveSource: tenantRes.source,
          leadIsDeleted: lead.isDeleted,
        },
      },
    });
  } catch {
    // ignore
  }

  // Provider stub: we DO NOT send emails in MVP, but contract is honored.
  return jsonOk(req, {
    leadId: lead.id,
    sentTo,
    mode,
  });
}
