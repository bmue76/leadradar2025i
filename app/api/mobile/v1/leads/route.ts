// app/api/mobile/v1/leads/route.ts
import { jsonOk, jsonError } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInputJsonValue(v: unknown): Prisma.InputJsonValue | null {
  try {
    // ensures JSON-serializable (no Date/BigInt/functions)
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function mergeCardMeta(metaJson: Prisma.InputJsonValue | undefined, nowIso: string) {
  // We enforce meta to be an object (or create one) and inject card-required defaults
  const base: Record<string, any> =
    metaJson && isPlainObject(metaJson) ? { ...(metaJson as any) } : {};

  const card0: Record<string, any> = isPlainObject(base.card) ? { ...(base.card as any) } : {};

  base.card = {
    ...card0,
    required: true,
    present: Boolean(card0.present) === true, // keep if already true
    updatedAt: nowIso,
  };

  return base as Prisma.InputJsonValue;
}

async function hasBusinessCardAttachment(tenantId: string, leadId: string) {
  const n = await prisma.leadAttachment.count({
    where: {
      tenantId,
      leadId,
      OR: [{ type: "IMAGE" }, { type: "PDF" }],
    },
  });
  return n > 0;
}

export async function POST(req: Request) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  if (tenantRes.ok !== true) {
    return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
  }
  const tenantId = tenantRes.tenant.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "BAD_JSON", "Invalid JSON body.");
  }

  if (!isRecord(body)) {
    return jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.");
  }

  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  const clientLeadId = typeof body.clientLeadId === "string" ? body.clientLeadId.trim() : "";

  if (!formId) {
    return jsonError(req, 400, "FORM_ID_REQUIRED", "formId is required.");
  }
  if (!clientLeadId) {
    return jsonError(req, 400, "CLIENT_LEAD_ID_REQUIRED", "clientLeadId is required.");
  }

  const valuesRaw = body.values;
  if (!isRecord(valuesRaw)) {
    return jsonError(req, 400, "VALUES_REQUIRED", "values must be an object.");
  }

  const valuesJson = toInputJsonValue(valuesRaw);
  if (!valuesJson) {
    return jsonError(req, 400, "VALUES_NOT_JSON", "values must be JSON-serializable.");
  }

  // optional meta (object only)
  const metaRaw = (body as any).meta;
  let metaJson: Prisma.InputJsonValue | undefined;
  if (metaRaw !== undefined) {
    if (!isRecord(metaRaw)) {
      return jsonError(req, 400, "META_INVALID", "meta must be an object.");
    }
    const m = toInputJsonValue(metaRaw);
    if (!m) {
      return jsonError(req, 400, "META_NOT_JSON", "meta must be JSON-serializable.");
    }
    metaJson = m;
  }

  const capturedAtRaw = typeof (body as any).capturedAt === "string" ? String((body as any).capturedAt).trim() : "";
  const capturedByDeviceUid =
    typeof (body as any).capturedByDeviceUid === "string" ? String((body as any).capturedByDeviceUid).trim() : "";

  // leak-safe form validation (404 if not in tenant OR not active)
  const form = await prisma.form.findFirst({
    where: {
      id: formId,
      tenantId,
      status: "ACTIVE",
    },
    select: { id: true, groupId: true },
  });

  if (!form) {
    return jsonError(req, 404, "NOT_FOUND", "Form not found.");
  }

  // capturedAt parsing
  let capturedAt: Date | undefined;
  if (capturedAtRaw) {
    const d = new Date(capturedAtRaw);
    if (Number.isNaN(d.getTime())) {
      return jsonError(req, 400, "BAD_CAPTURED_AT", "capturedAt must be ISO.");
    }
    capturedAt = d;
  }

  // Idempotency check via @@unique([tenantId, clientLeadId])
  const existing = await prisma.lead.findUnique({
    where: {
      tenantId_clientLeadId: {
        tenantId,
        clientLeadId,
      },
    },
    select: { id: true, capturedAt: true },
  });

  if (existing) {
    const present = await hasBusinessCardAttachment(tenantId, existing.id);
    return jsonOk(req, {
      id: existing.id,
      created: false,
      capturedAt: existing.capturedAt.toISOString(),
      attachment: { required: true, present },
    });
  }

  // Optional device linkage: tenantId+deviceUid unique
  let capturedByDeviceId: string | undefined;
  if (capturedByDeviceUid) {
    const device = await prisma.device.upsert({
      where: {
        tenantId_deviceUid: {
          tenantId,
          deviceUid: capturedByDeviceUid,
        },
      },
      update: {},
      create: {
        tenantId,
        deviceUid: capturedByDeviceUid,
        // MVP default
        platform: "ANDROID",
      },
      select: { id: true },
    });
    capturedByDeviceId = device.id;
  }

  // Ensure every lead starts with "card required" (present becomes true when attachment route receives BUSINESS_CARD image)
  const nowIso = new Date().toISOString();
  const metaWithCard = mergeCardMeta(metaJson, nowIso);

  const created = await prisma.lead.create({
    data: {
      tenantId,
      formId: form.id,
      groupId: form.groupId ?? null,
      clientLeadId,
      values: valuesJson,
      meta: metaWithCard,
      capturedAt: capturedAt ?? undefined,
      capturedByDeviceId: capturedByDeviceId ?? null,
    },
    select: { id: true, capturedAt: true },
  });

  return jsonOk(req, {
    id: created.id,
    created: true,
    capturedAt: created.capturedAt.toISOString(),
    attachment: { required: true, present: false },
  });
}
