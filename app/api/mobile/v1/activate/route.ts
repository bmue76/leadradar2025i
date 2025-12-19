// app/api/mobile/v1/activate/route.ts
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { normalizeLicenseKey } from "@/lib/license";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function canonicalizeLicenseKey(input: unknown): string | null {
  if (!isNonEmptyString(input)) return null;

  const normalized = normalizeLicenseKey(input);

  if (/^LR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized)) {
    return normalized;
  }

  const raw = normalized.replace(/-/g, "");
  if (/^LR[A-Z0-9]{16}$/.test(raw)) {
    const tail = raw.slice(2);
    return `LR-${tail.slice(0, 4)}-${tail.slice(4, 8)}-${tail.slice(8, 12)}-${tail.slice(12, 16)}`;
  }

  return normalized;
}

type DeviceMeta = {
  label?: unknown;
  osVersion?: unknown;
  appVersion?: unknown;
};

function pickDeviceMeta(meta: unknown): { label?: string; osVersion?: string; appVersion?: string } {
  const m = (meta ?? {}) as DeviceMeta;
  const out: { label?: string; osVersion?: string; appVersion?: string } = {};
  if (isNonEmptyString(m.label)) out.label = m.label.trim();
  if (isNonEmptyString(m.osVersion)) out.osVersion = m.osVersion.trim();
  if (isNonEmptyString(m.appVersion)) out.appVersion = m.appVersion.trim();
  return out;
}

function addDays(base: Date, days: number): Date {
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(base.getTime() + ms);
}

async function resolveTenantIdBySlugOrId(tx: PrismaClient, tenantSlugOrId: string): Promise<string | null> {
  // 1) preferred: slug
  const bySlug = await tx.tenant.findUnique({
    where: { slug: tenantSlugOrId },
    select: { id: true },
  });
  if (bySlug?.id) return bySlug.id;

  // 2) DEV fallback: treat value as tenantId
  const byId = await tx.tenant.findUnique({
    where: { id: tenantSlugOrId },
    select: { id: true },
  });
  return byId?.id ?? null;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body");
  }

  const licenseKey = canonicalizeLicenseKey(body?.licenseKey);
  const platform = body?.platform;
  const deviceUid = body?.deviceUid;
  const tenantSlugRaw = body?.tenantSlug;

  if (!licenseKey) return jsonError(req, 400, "INVALID_REQUEST", "licenseKey is required");
  if (platform !== "IOS" && platform !== "ANDROID") {
    return jsonError(req, 400, "INVALID_REQUEST", "platform must be IOS or ANDROID");
  }
  if (!isNonEmptyString(deviceUid)) return jsonError(req, 400, "INVALID_REQUEST", "deviceUid is required");

  const deviceMeta = pickDeviceMeta(body?.deviceMeta);
  const tenantSlug = isNonEmptyString(tenantSlugRaw) ? tenantSlugRaw.trim() : null;

  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lk = await tx.licenseKey.findUnique({
        where: { key: licenseKey },
        select: {
          id: true,
          key: true,
          source: true,
          status: true,
          durationDays: true,
          tenantId: true,
          deviceId: true,
          redeemedAt: true,
          activatedAt: true,
          expiresAt: true,
        },
      });

      if (!lk) return { kind: "INVALID_KEY" as const };

      if (lk.status === "REVOKED") return { kind: "REVOKED" as const };
      if (lk.status === "PENDING") return { kind: "PAYMENT_PENDING" as const };

      if (lk.status === "EXPIRED" || (lk.expiresAt && lk.expiresAt.getTime() < now.getTime())) {
        if (lk.status !== "EXPIRED") {
          await tx.licenseKey.update({ where: { id: lk.id }, data: { status: "EXPIRED" } });
        }
        return { kind: "LICENSE_EXPIRED" as const };
      }

      let tenantId = lk.tenantId;
      let wasRedeemed = false;

      if (lk.source === "PROMO" && !tenantId) {
        if (!tenantSlug) return { kind: "TENANT_REQUIRED" as const };

        const resolvedTenantId = await resolveTenantIdBySlugOrId(tx as any, tenantSlug);
        if (!resolvedTenantId) return { kind: "TENANT_NOT_FOUND" as const };

        tenantId = resolvedTenantId;
        wasRedeemed = true;

        await tx.licenseKey.update({
          where: { id: lk.id },
          data: {
            tenantId,
            redeemedAt: lk.redeemedAt ?? now,
          },
        });
      }

      if (!tenantId) return { kind: "TENANT_REQUIRED" as const };

      const device = await tx.device.upsert({
        where: {
          tenantId_deviceUid: {
            tenantId,
            deviceUid: deviceUid.trim(),
          },
        },
        create: {
          tenantId,
          deviceUid: deviceUid.trim(),
          platform,
          ...deviceMeta,
        },
        update: {
          platform,
          ...deviceMeta,
        },
        select: { id: true, tenantId: true },
      });

      if (lk.deviceId && lk.deviceId !== device.id) {
        return { kind: "KEY_ALREADY_BOUND" as const };
      }

      const wasIdempotent = lk.deviceId === device.id && lk.status === "ACTIVE" && !!lk.expiresAt;

      const activatedAt = lk.activatedAt ?? now;
      const expiresAt = lk.expiresAt ?? addDays(activatedAt, lk.durationDays);

      if (!wasIdempotent || !lk.activatedAt || !lk.expiresAt || lk.status !== "ACTIVE" || lk.deviceId !== device.id) {
        await tx.licenseKey.update({
          where: { id: lk.id },
          data: {
            tenantId,
            deviceId: device.id,
            status: "ACTIVE",
            activatedAt: lk.activatedAt ?? now,
            expiresAt: lk.expiresAt ?? expiresAt,
          },
        });
      }

      await tx.deviceActivation.upsert({
        where: {
          deviceId_licenseKeyId: {
            deviceId: device.id,
            licenseKeyId: lk.id,
          },
        },
        create: {
          tenantId,
          deviceId: device.id,
          licenseKeyId: lk.id,
          status: "SUCCESS" as any,
          reason: null,
        },
        update: {
          status: "SUCCESS" as any,
          reason: null,
        },
        select: { id: true },
      });

      return {
        kind: "OK" as const,
        payload: {
          status: "ACTIVE" as const,
          expiresAt,
          tenantId,
          deviceId: device.id,
          licenseKeyId: lk.id,
          wasRedeemed,
          wasIdempotent,
        },
      };
    });

    switch (result.kind) {
      case "INVALID_KEY":
        return jsonError(req, 404, "INVALID_KEY", "License key not found");
      case "REVOKED":
        return jsonError(req, 403, "REVOKED", "License key revoked");
      case "PAYMENT_PENDING":
        return jsonError(req, 402, "PAYMENT_PENDING", "Payment pending");
      case "LICENSE_EXPIRED":
        return jsonError(req, 403, "LICENSE_EXPIRED", "License expired");
      case "KEY_ALREADY_BOUND":
        return jsonError(req, 409, "KEY_ALREADY_BOUND", "License key already bound to another device");
      case "TENANT_REQUIRED":
        return jsonError(req, 400, "TENANT_REQUIRED", "tenantSlug is required for promo keys");
      case "TENANT_NOT_FOUND":
        return jsonError(req, 404, "TENANT_NOT_FOUND", "Tenant not found");
      case "OK":
        return jsonOk(req, result.payload);
      default:
        return jsonError(req, 500, "INTERNAL_ERROR", "Activation failed");
    }
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Activation failed");
  }
}
