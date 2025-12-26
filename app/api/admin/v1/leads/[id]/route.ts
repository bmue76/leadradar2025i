import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

type LeadAttachmentDto = {
  id: string;
  type: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  storageKey: string | null;
  url: string | null;
  createdAt: string; // ISO
};

type LeadDetailDto = {
  id: string;
  formId: string;
  groupId: string | null;
  capturedByDeviceId: string | null;
  clientLeadId: string;

  values: unknown;
  meta: unknown | null;

  capturedAt: string; // ISO
  isDeleted: boolean;
  deletedAt: string | null;
  deletedReason: string | null;
  deletedByUserId: string | null;

  createdAt: string; // ISO
  updatedAt: string; // ISO

  attachments: LeadAttachmentDto[];

  form: {
    id: string;
    name: string;
    status: string;
    groupId: string | null;
  };

  group: {
    id: string;
    name: string;
    status: string;
  } | null;

  device: {
    id: string;
    deviceUid: string;
  } | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")?.trim();
  if (xff) return xff.split(",")[0]?.trim() || null;
  const xri = req.headers.get("x-real-ip")?.trim();
  return xri || null;
}

function getUserAgent(req: Request): string | null {
  const ua = req.headers.get("user-agent")?.trim();
  return ua || null;
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

  // Fallback: parse from URL path (robust against any ctx issues)
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last.trim();
  } catch {
    return "";
  }
}

async function findLeadOr404(req: Request, tenantId: string, id: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId },
    include: {
      attachments: { orderBy: { createdAt: "desc" } },
      form: { select: { id: true, name: true, status: true, groupId: true } },
      group: { select: { id: true, name: true, status: true } },
      capturedByDevice: { select: { id: true, deviceUid: true } },
    },
  });

  if (!lead) {
    return {
      ok: false as const,
      res: jsonError(req, 404, "NOT_FOUND", "Lead not found."),
    };
  }

  return { ok: true as const, lead };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = await leadIdFromCtxOrUrl(req, ctx);
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");

  const found = await findLeadOr404(req, scoped.ctx.tenantId, id);
  if (!found.ok) return found.res;

  const lead = found.lead;

  const payload: LeadDetailDto = {
    id: lead.id,
    formId: lead.formId,
    groupId: lead.groupId ?? null,
    capturedByDeviceId: lead.capturedByDeviceId ?? null,
    clientLeadId: lead.clientLeadId,

    values: lead.values,
    meta: lead.meta ?? null,

    capturedAt: lead.capturedAt.toISOString(),
    isDeleted: lead.isDeleted,
    deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
    deletedReason: lead.deletedReason ?? null,
    deletedByUserId: lead.deletedByUserId ?? null,

    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),

    attachments: lead.attachments.map((a) => ({
      id: a.id,
      type: a.type,
      filename: a.filename ?? null,
      mimeType: a.mimeType ?? null,
      sizeBytes: a.sizeBytes ?? null,
      checksum: a.checksum ?? null,
      storageKey: a.storageKey ?? null,
      url: a.url ?? null,
      createdAt: a.createdAt.toISOString(),
    })),

    form: {
      id: lead.form.id,
      name: lead.form.name,
      status: lead.form.status,
      groupId: lead.form.groupId ?? null,
    },

    group: lead.group
      ? { id: lead.group.id, name: lead.group.name, status: lead.group.status }
      : null,

    device: lead.capturedByDevice
      ? { id: lead.capturedByDevice.id, deviceUid: lead.capturedByDevice.deviceUid }
      : null,
  };

  return jsonOk(req, payload);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = await leadIdFromCtxOrUrl(req, ctx);
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body.");
  }

  const hasValues = Object.prototype.hasOwnProperty.call(body ?? {}, "values");
  const hasMeta = Object.prototype.hasOwnProperty.call(body ?? {}, "meta");

  if (!hasValues && !hasMeta) {
    return jsonError(req, 400, "INVALID_REQUEST", 'Provide at least "values" or "meta".');
  }

  const found = await findLeadOr404(req, scoped.ctx.tenantId, id);
  if (!found.ok) return found.res;

  const lead = found.lead;

  let valuesData: Prisma.InputJsonValue | undefined = undefined;
  let metaData:
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput
    | undefined = undefined;

  if (hasValues) {
    const incoming = body.values;

    if (isPlainObject(incoming) && isPlainObject(lead.values)) {
      valuesData = { ...(lead.values as any), ...(incoming as any) } as Prisma.InputJsonValue;
    } else {
      valuesData = incoming as Prisma.InputJsonValue;
    }
  }

  if (hasMeta) {
    const incoming = body.meta;

    if (incoming === null) {
      // nullable Json? -> set DB NULL, not JS null
      metaData = Prisma.DbNull;
    } else if (isPlainObject(incoming) && isPlainObject(lead.meta)) {
      metaData = { ...(lead.meta as any), ...(incoming as any) } as Prisma.InputJsonValue;
    } else {
      metaData = incoming as Prisma.InputJsonValue;
    }
  }

  const valuesKeys =
    hasValues && isPlainObject(body.values) ? Object.keys(body.values).slice(0, 50) : null;
  const metaKeys = hasMeta && isPlainObject(body.meta) ? Object.keys(body.meta).slice(0, 50) : null;

  const now = new Date();
  const ip = getIp(req);
  const userAgent = getUserAgent(req);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: lead.id },
        data: {
          ...(valuesData === undefined ? {} : { values: valuesData }),
          ...(metaData === undefined ? {} : { meta: metaData }),
          updatedAt: now,
        },
        select: { id: true, updatedAt: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "LEAD_UPDATED",
          entityType: "LEAD",
          entityId: lead.id,
          ip,
          userAgent,
          meta: {
            valuesUpdated: hasValues,
            metaUpdated: hasMeta,
            valuesKeys,
            metaKeys,
          },
        },
      });

      return row;
    });

    return jsonOk(req, { id: updated.id, updatedAt: updated.updatedAt.toISOString() });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to update lead.");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = await leadIdFromCtxOrUrl(req, ctx);
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // body optional
  }

  const reasonRaw = body?.reason ?? body?.deletedReason ?? null;
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0 ? reasonRaw.trim() : null;

  const found = await findLeadOr404(req, scoped.ctx.tenantId, id);
  if (!found.ok) return found.res;

  const lead = found.lead;

  const now = new Date();
  const ip = getIp(req);
  const userAgent = getUserAgent(req);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: lead.id },
        data: {
          isDeleted: true,
          deletedAt: lead.deletedAt ?? now,
          deletedByUserId: scoped.ctx.user.id,
          deletedReason: reason ?? lead.deletedReason ?? null,
          updatedAt: now,
        },
        select: {
          id: true,
          isDeleted: true,
          deletedAt: true,
          deletedReason: true,
          deletedByUserId: true,
          updatedAt: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: scoped.ctx.tenantId,
          actorType: "USER",
          actorUserId: scoped.ctx.user.id,
          action: "LEAD_SOFT_DELETED",
          entityType: "LEAD",
          entityId: lead.id,
          ip,
          userAgent,
          meta: { reason: reason ?? null },
        },
      });

      return row;
    });

    return jsonOk(req, {
      id: updated.id,
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
      deletedReason: updated.deletedReason ?? null,
      deletedByUserId: updated.deletedByUserId ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to soft-delete lead.");
  }
}
