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
      form: {
        ...form,
        status: String(form.status),
        createdAt: form.createdAt.toISOString(),
        updatedAt: form.updatedAt.toISOString(),
      },
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
