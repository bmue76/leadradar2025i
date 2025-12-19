import type { Tenant, User } from "@prisma/client";
import type { NextResponse } from "next/server";
import prisma from "./prisma";
import { jsonError, type ApiErrorBody } from "./api";

export type AuthContext = {
  user: User;
  tenant: Tenant | null;
};

export type TenantContext = {
  user: User;
  tenant: Tenant;
  tenantId: string;
};

type AuthResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; res: NextResponse<ApiErrorBody> };

type TenantResult =
  | { ok: true; ctx: TenantContext }
  | { ok: false; res: NextResponse<ApiErrorBody> };

function headerTrim(req: Request, key: string): string | null {
  const v = req.headers.get(key);
  const t = v?.trim();
  return t ? t : null;
}

export async function requireAuthContext(req: Request): Promise<AuthResult> {
  const userId = headerTrim(req, "x-user-id");
  if (!userId) {
    return {
      ok: false,
      res: jsonError(req, 401, "UNAUTHENTICATED", 'Missing header "x-user-id".'),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: true },
  });

  if (!user) {
    return {
      ok: false,
      res: jsonError(req, 401, "UNAUTHENTICATED", "Unknown user."),
    };
  }

  return { ok: true, ctx: { user, tenant: user.tenant } };
}

export async function requireTenantContext(req: Request): Promise<TenantResult> {
  const auth = await requireAuthContext(req);
  if (!auth.ok) return auth;

  const { user, tenant } = auth.ctx;

  // Minimal Admin Auth (Owner-only)
  if (user.role !== "TENANT_OWNER") {
    return {
      ok: false,
      res: jsonError(
        req,
        403,
        "FORBIDDEN",
        "Owner role required for admin access."
      ),
    };
  }

  if (!user.tenantId || !tenant) {
    return {
      ok: false,
      res: jsonError(req, 403, "FORBIDDEN", "User is not assigned to a tenant."),
    };
  }

  // Optional explicit tenant scope header (blocks scope-leak attempts)
  const requestedTenantId = headerTrim(req, "x-tenant-id");
  if (requestedTenantId && requestedTenantId !== user.tenantId) {
    return {
      ok: false,
      res: jsonError(req, 403, "FORBIDDEN", "Tenant scope mismatch."),
    };
  }

  return { ok: true, ctx: { user, tenant, tenantId: user.tenantId } };
}
