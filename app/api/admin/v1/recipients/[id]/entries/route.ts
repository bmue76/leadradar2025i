// app/api/admin/v1/recipients/[id]/entries/route.ts
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

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

async function getListIdFromCtxOrUrl(
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

  // Fallback: /api/admin/v1/recipients/{id}/entries
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("recipients");
    if (idx >= 0 && parts[idx + 1]) return String(parts[idx + 1]).trim();
  } catch {
    // ignore
  }
  return "";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const recipientListId = await getListIdFromCtxOrUrl(req, ctx);
  if (!recipientListId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing recipient list id.");
  }

  // leak-safe list validation
  const list = await prisma.recipientList.findFirst({
    where: { id: recipientListId, tenantId: scoped.ctx.tenantId },
    select: { id: true },
  });
  if (!list) return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");

  const entries = await prisma.recipientListEntry.findMany({
    where: { tenantId: scoped.ctx.tenantId, recipientListId: list.id },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, email: true, name: true, createdAt: true },
  });

  return jsonOk(req, {
    items: entries.map((e) => ({
      id: e.id,
      email: e.email,
      name: e.name ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const recipientListId = await getListIdFromCtxOrUrl(req, ctx);
  if (!recipientListId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing recipient list id.");
  }

  // leak-safe list validation
  const list = await prisma.recipientList.findFirst({
    where: { id: recipientListId, tenantId: scoped.ctx.tenantId },
    select: { id: true },
  });
  if (!list) return jsonError(req, 404, "NOT_FOUND", "Recipient list not found.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "BAD_JSON", "Invalid JSON body.");
  }
  if (!isRecord(body)) {
    return jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.");
  }

  const emailRaw = body.email;
  if (!isNonEmptyString(emailRaw)) {
    return jsonError(req, 400, "EMAIL_REQUIRED", "email is required.");
  }
  const email = normalizeEmail(emailRaw);
  if (!looksLikeEmail(email)) {
    return jsonError(req, 400, "BAD_EMAIL", "email must be a valid email address.");
  }

  const name = isNonEmptyString(body.name) ? body.name.trim().slice(0, 200) : null;

  try {
    const created = await prisma.recipientListEntry.create({
      data: {
        tenantId: scoped.ctx.tenantId,
        recipientListId: list.id,
        email,
        name,
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    // Audit (best effort)
    try {
      await prisma.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "RECIPIENT_ENTRY_CREATED",
          entityType: "RECIPIENT_LIST_ENTRY",
          entityId: created.id,
          meta: { recipientListId: list.id, email: created.email },
        },
      });
    } catch {
      // ignore
    }

    return jsonOk(
      req,
      {
        id: created.id,
        email: created.email,
        name: created.name ?? null,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (e: any) {
    // Prisma unique constraint => duplicate email per list
    const msg = String(e?.message || "");
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      return jsonError(req, 409, "DUPLICATE", "Email already exists in this list.");
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to create recipient entry.");
  }
}
