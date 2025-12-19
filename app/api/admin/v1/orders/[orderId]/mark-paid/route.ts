// app/api/admin/v1/orders/[orderId]/mark-paid/route.ts
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

function getParamOrderId(req: NextRequest): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "orders");
  if (idx === -1) return null;
  return parts[idx + 1] ?? null;
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

  const { tenantId, userId: actorUserId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }

  const orderId = getParamOrderId(req);
  if (!orderId) {
    return jsonError(req, 400, "INVALID_REQUEST", "orderId is required");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!order) return { kind: "not_found" as const };

      if (order.tenantId !== tenantId) return { kind: "forbidden" as const };

      if (order.status === "PAID") {
        return { kind: "already_paid" as const, order };
      }

      const payment = await tx.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          provider: "MANUAL",
          status: "SUCCEEDED",
          amountCents: order.totalCents,
          currency: order.currency,
        },
        select: {
          id: true,
          orderId: true,
          provider: true,
          status: true,
          amountCents: true,
          currency: true,
          createdAt: true,
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
        select: {
          id: true,
          tenantId: true,
          status: true,
          totalCents: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const now = new Date();
      const licenseKeyUpdate = await tx.licenseKey.updateMany({
        where: { orderId: order.id, status: { in: ["PENDING"] } },
        data: { status: "ISSUED", issuedAt: now },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorType: "USER",
          actorUserId: actorUserId ?? undefined,
          action: "ORDER_MARK_PAID",
          entityType: "Order",
          entityId: order.id,
          ip: req.headers.get("x-forwarded-for") ?? undefined,
          userAgent: req.headers.get("user-agent") ?? undefined,
          meta: {
            orderId: order.id,
            paymentId: payment.id,
            provider: payment.provider,
            amountCents: payment.amountCents,
            currency: payment.currency,
            licenseKeysUpdated: licenseKeyUpdate.count,
            note: "DEV/STUB mark-paid",
          },
        },
      });

      return {
        kind: "ok" as const,
        order: updatedOrder,
        payment,
        licenseKeysUpdated: licenseKeyUpdate.count,
      };
    });

    if (result.kind === "not_found") {
      return jsonError(req, 404, "ORDER_NOT_FOUND", "Order not found");
    }
    if (result.kind === "forbidden") {
      return jsonError(req, 403, "FORBIDDEN", "Order does not belong to tenant");
    }
    if (result.kind === "already_paid") {
      return jsonOk(req, { order: result.order, alreadyPaid: true });
    }

    return jsonOk(req, {
      order: result.order,
      payment: result.payment,
      licenseKeysUpdated: result.licenseKeysUpdated,
    });
  } catch (e) {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to mark order as paid");
  }
}
