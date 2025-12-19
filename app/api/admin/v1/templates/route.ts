// app/api/admin/v1/templates/route.ts
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

async function resolveTenantId(req: NextRequest, ctx: any): Promise<string | null> {
  const headerUserId = req.headers.get("x-user-id");

  const userId: string | null =
    (isNonEmptyString(ctx?.userId) && ctx.userId) ||
    (isNonEmptyString(ctx?.user?.id) && ctx.user.id) ||
    (isNonEmptyString(headerUserId) && headerUserId) ||
    null;

  let tenantId: string | null =
    (isNonEmptyString(ctx?.tenantId) && ctx.tenantId) ||
    (isNonEmptyString(ctx?.tenant?.id) && ctx.tenant.id) ||
    (isNonEmptyString(ctx?.tenant) && ctx.tenant) ||
    null;

  // Fallback: tenantId via User lookup (damit x-tenant-id Header nicht zwingend ist)
  if (!tenantId && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    tenantId = u?.tenantId ?? null;
  }

  return tenantId;
}

type TemplateListItem = {
  id: string;
  kind: "SYSTEM" | "TENANT";
  systemKey: string | null;
  name: string;
  description: string | null;
  slug: string; // API garantiert string
  updatedAt: string; // ISO
};

export async function GET(req: NextRequest) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  const tenantId = await resolveTenantId(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  try {
    const [systemTemplates, tenantTemplates] = await Promise.all([
      prisma.formTemplate.findMany({
        where: { kind: "SYSTEM", tenantId: null },
        select: {
          id: true,
          kind: true,
          systemKey: true,
          name: true,
          description: true,
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.formTemplate.findMany({
        where: { kind: "TENANT", tenantId },
        select: {
          id: true,
          kind: true,
          systemKey: true,
          name: true,
          description: true,
          slug: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
    ]);

    const items: TemplateListItem[] = [
      ...systemTemplates.map<TemplateListItem>((t) => ({
        id: t.id,
        kind: "SYSTEM",
        systemKey: t.systemKey ?? null,
        name: t.name,
        description: t.description ?? null,
        slug: t.slug ?? t.systemKey ?? t.id,
        updatedAt: t.updatedAt.toISOString(),
      })),
      ...tenantTemplates.map<TemplateListItem>((t) => ({
        id: t.id,
        kind: "TENANT",
        systemKey: t.systemKey ?? null,
        name: t.name,
        description: t.description ?? null,
        slug: t.slug ?? t.systemKey ?? t.id,
        updatedAt: t.updatedAt.toISOString(),
      })),
    ];

    return jsonOk(req, { items });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to load templates");
  }
}
