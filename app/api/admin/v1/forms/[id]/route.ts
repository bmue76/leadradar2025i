// app/api/admin/v1/forms/[id]/route.ts
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function resolveTenantAndUser(req: NextRequest, ctx: any): Promise<{
  tenantId: string | null;
  userId: string | null;
}> {
  const headerUserId = req.headers.get("x-user-id");
  const headerTenantId = req.headers.get("x-tenant-id");

  const userId: string | null =
    (isNonEmptyString(ctx?.userId) && ctx.userId) ||
    (isNonEmptyString(ctx?.user?.id) && ctx.user.id) ||
    (isNonEmptyString(headerUserId) && headerUserId) ||
    null;

  let tenantId: string | null =
    (isNonEmptyString(ctx?.tenantId) && ctx.tenantId) ||
    (isNonEmptyString(ctx?.tenant?.id) && ctx.tenant.id) ||
    (isNonEmptyString(ctx?.tenant) && ctx.tenant) ||
    (isNonEmptyString(headerTenantId) && headerTenantId) ||
    null;

  if (!tenantId && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    tenantId = u?.tenantId ?? null;
  }

  return { tenantId, userId };
}

async function resolveIdParam(context: any): Promise<string | null> {
  const p = context?.params;

  // Next kann params synchron ODER als Promise liefern (je nach Version/Runtime)
  const paramsObj =
    p && typeof p === "object" && typeof (p as any).then === "function" ? await p : p;

  const id = paramsObj?.id;
  return isNonEmptyString(id) ? id.trim() : null;
}

function serializeForm(form: any) {
  return {
    ...form,
    status: String(form.status),
    createdAt: form.createdAt?.toISOString?.() ?? form.createdAt,
    updatedAt: form.updatedAt?.toISOString?.() ?? form.updatedAt,
  };
}

const ALLOWED_STATUSES = new Set(["DRAFT", "ACTIVE", "ARCHIVED"]);

export async function GET(req: NextRequest, context: any) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  const { tenantId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  const id = await resolveIdParam(context);
  if (!id) {
    return jsonError(req, 400, "INVALID_REQUEST", "id is required");
  }

  try {
    const form = await prisma.form.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        templateId: true,
        groupId: true,
        name: true,
        status: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        createdByUserId: true,
      },
    });

    if (!form) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found");
    }

    const fields = await prisma.formField.findMany({
      where: { formId: form.id, tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        formId: true,
        key: true,
        label: true,
        type: true,
        required: true,
        config: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk(req, {
      form: serializeForm(form),
      fields: fields.map((f) => ({
        ...f,
        type: String(f.type),
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to load form");
  }
}

export async function PATCH(req: NextRequest, context: any) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  const { tenantId, userId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  const id = await resolveIdParam(context);
  if (!id) {
    return jsonError(req, 400, "INVALID_REQUEST", "id is required");
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const statusRaw = body?.status;
  const nameRaw = body?.name;
  const descriptionRaw = body?.description;

  const data: any = {};

  // status
  if (statusRaw !== undefined) {
    if (!isNonEmptyString(statusRaw)) {
      return jsonError(req, 400, "INVALID_REQUEST", "status must be a non-empty string");
    }
    const status = statusRaw.trim().toUpperCase();
    if (!ALLOWED_STATUSES.has(status)) {
      return jsonError(
        req,
        400,
        "INVALID_REQUEST",
        `status must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`
      );
    }
    data.status = status as any;
  }

  // name (optional)
  if (nameRaw !== undefined) {
    if (!isNonEmptyString(nameRaw)) {
      return jsonError(req, 400, "INVALID_REQUEST", "name must be a non-empty string");
    }
    data.name = nameRaw.trim();
  }

  // description (optional; only applied if present)
  // NOTE: This is "schema-safe": we only include it if client sends it,
  // and we cast data to any when updating. If your Prisma schema has no `description`,
  // simply don't send it.
  if (descriptionRaw !== undefined) {
    if (descriptionRaw === null) {
      data.description = null;
    } else if (typeof descriptionRaw === "string") {
      data.description = descriptionRaw.trim();
    } else {
      return jsonError(req, 400, "INVALID_REQUEST", "description must be a string or null");
    }
  }

  if (Object.keys(data).length === 0) {
    return jsonError(req, 400, "INVALID_REQUEST", "At least one field must be provided");
  }

  try {
    const existing = await prisma.form.findFirst({
      where: { id, tenantId },
      select: { id: true, tenantId: true, status: true },
    });

    // leak-safe 404
    if (!existing) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found");
    }

    const updated = await prisma.form.update({
      where: { id },
      data: data as any,
      select: {
        id: true,
        tenantId: true,
        templateId: true,
        groupId: true,
        name: true,
        status: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        createdByUserId: true,
      },
    });

    // AuditEvent (best-effort): FORM_STATUS_CHANGED (meta from/to)
    try {
      const fromStatus = String(existing.status);
      const toStatus = String(updated.status);

      if (data.status && fromStatus !== toStatus) {
        await (prisma as any).auditEvent?.create?.({
          data: {
            tenantId,
            actorUserId: userId,
            type: "FORM_STATUS_CHANGED",
            entityType: "FORM",
            entityId: id,
            meta: { from: fromStatus, to: toStatus },
          },
        });
      }
    } catch {
      // best-effort: never fail the request
    }

    return jsonOk(req, { form: serializeForm(updated) });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to update form");
  }
}
