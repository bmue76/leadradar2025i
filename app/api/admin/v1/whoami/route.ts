import { jsonOk } from "../../../../../lib/api";
import { requireTenantContext } from "../../../../../lib/auth";

export async function GET(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const { user, tenant } = scoped.ctx;

  return jsonOk(req, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
    },
  });
}
