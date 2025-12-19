// app/api/admin/v1/orders/route.ts
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";
import { generateLicenseKey } from "@/lib/license";

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

  if (!tenantId && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    tenantId = u?.tenantId ?? null;
  }

  return { tenantId, userId };
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body");
  }

  const packageCode = body?.packageCode;
  if (!isNonEmptyString(packageCode)) {
    return jsonError(req, 400, "INVALID_REQUEST", "packageCode is required");
  }

  const { tenantId, userId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  try {
    const pkg = await prisma.package.findUnique({
      where: { code: packageCode.trim() },
      select: {
        id: true,
        code: true,
        name: true,
        durationDays: true,
        priceCents: true,
        currency: true,
        status: true,
      },
    });

    if (!pkg) {
      return jsonError(req, 404, "PACKAGE_NOT_FOUND", "Package not found");
    }

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          tenantId,
          userId: userId ?? undefined,
          packageId: pkg.id,
          status: "CREATED",
          totalCents: pkg.priceCents,
          currency: pkg.currency,
        },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          packageId: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      let licenseKeyCreated:
        | {
            id: string;
            key: string;
            source: any;
            status: any;
            durationDays: number;
            tenantId: string | null;
            orderId: string | null;
            deviceId: string | null;
            issuedAt: Date | null;
            redeemedAt: Date | null;
            activatedAt: Date | null;
            expiresAt: Date | null;
            revokedAt: Date | null;
            notes: string | null;
            createdAt: Date;
            updatedAt: Date;
          }
        | null = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const key = generateLicenseKey({ prefix: "LR", groups: 4, groupLength: 4 });
        try {
          licenseKeyCreated = await tx.licenseKey.create({
            data: {
              key,
              source: "PURCHASED",
              status: "PENDING",
              tenantId,
              orderId: order.id,
              durationDays: pkg.durationDays,
            },
            select: {
              id: true,
              key: true,
              source: true,
              status: true,
              durationDays: true,
              tenantId: true,
              orderId: true,
              deviceId: true,
              issuedAt: true,
              redeemedAt: true,
              activatedAt: true,
              expiresAt: true,
              revokedAt: true,
              notes: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          break;
        } catch (err: any) {
          if (err?.code === "P2002") continue;
          throw err;
        }
      }

      if (!licenseKeyCreated) {
        throw new Error("LICENSE_KEY_GENERATION_FAILED");
      }

      return { order, licenseKey: licenseKeyCreated, package: pkg };
    });

    return jsonOk(req, {
      order: created.order,
      licenseKey: created.licenseKey,
      package: created.package,
    });
  } catch (e: any) {
    if (e?.message === "LICENSE_KEY_GENERATION_FAILED") {
      return jsonError(req, 500, "INTERNAL_ERROR", "Failed to generate license key");
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to create order");
  }
}
