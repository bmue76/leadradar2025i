// app/api/admin/v1/forms/route.ts
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

  // Fallback: tenantId via User lookup
  if (!tenantId && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    tenantId = u?.tenantId ?? null;
  }

  return { tenantId, userId };
}

type FormListItem = {
  id: string;
  name: string;
  status: string;
  groupId: string | null;
  templateId: string | null;
  updatedAt: string; // ISO
};

export async function GET(req: NextRequest) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  const { tenantId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  try {
    const forms = await prisma.form.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        groupId: true,
        templateId: true,
        updatedAt: true,
      },
    });

    const items: FormListItem[] = forms.map((f) => ({
      id: f.id,
      name: f.name,
      status: String(f.status),
      groupId: f.groupId ?? null,
      templateId: f.templateId ?? null,
      updatedAt: f.updatedAt.toISOString(),
    }));

    return jsonOk(req, { items });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to load forms");
  }
}
