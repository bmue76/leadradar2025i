// lib/tenant-mobile.ts
  import type { PrismaClient, Tenant } from '@prisma/client';

  export type TenantResolveSource = 'slug' | 'id-dev';

  export type TenantResolveErrorCode =
    | 'TENANT_REQUIRED'
    | 'TENANT_NOT_FOUND';

  export type TenantResolveResult =
    | { ok: true; tenant: Tenant; source: TenantResolveSource }
    | { ok: false; code: TenantResolveErrorCode; status: 401; message: string };

  /**
   * Mobile Tenant Resolve (1.5 ASSUMPTION)
   * - Prefer: x-tenant-slug
   * - DEV fallback: x-tenant-id
   */
  export async function resolveTenantFromMobileHeaders(
    prisma: PrismaClient,
    headers: Headers
  ): Promise<TenantResolveResult> {
    const tenantSlug = headers.get('x-tenant-slug')?.trim() || '';
    const tenantId = headers.get('x-tenant-id')?.trim() || '';

    if (!tenantSlug && !tenantId) {
      return {
        ok: false,
        code: 'TENANT_REQUIRED',
        status: 401,
        message:
          'Tenant header required: send x-tenant-slug (preferred) or x-tenant-id (DEV fallback).',
      };
    }

    const tenant = tenantSlug
      ? await prisma.tenant.findUnique({ where: { slug: tenantSlug } })
      : await prisma.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant) {
      return {
        ok: false,
        code: 'TENANT_NOT_FOUND',
        status: 401,
        message: tenantSlug
          ? `Tenant not found for slug '${tenantSlug}'.`
          : `Tenant not found for id '${tenantId}'.`,
      };
    }

    return {
      ok: true,
      tenant,
      source: tenantSlug ? 'slug' : 'id-dev',
    };
  }