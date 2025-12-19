import { jsonOk } from "../../../../../../lib/api";
import { requireTenantContext } from "../../../../../../lib/auth";

export async function GET(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const { tenant, user } = scoped.ctx;

  return jsonOk(req, {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      retentionDays: tenant.retentionDays,
    },
    scope: {
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
    },
  });
}
