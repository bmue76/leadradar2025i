 // app/api/mobile/v1/forms/route.ts
  import { jsonOk, jsonError } from '@/lib/api';
  import { resolveTenantFromMobileHeaders } from '@/lib/tenant-mobile';
  import { prisma } from '@/lib/db';

  export async function GET(req: Request) {
    const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
    if (!tenantRes.ok) {
      return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
    }

    const forms = await prisma.form.findMany({
      where: {
        tenantId: tenantRes.tenant.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        groupId: true,
        updatedAt: true,
        _count: { select: { fields: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const dto = forms.map((f: (typeof forms)[number]) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? null,
      status: f.status,
      groupId: f.groupId ?? null,
      updatedAt: f.updatedAt.toISOString(),
      fieldCount: f._count.fields,
    }));

    return jsonOk(req, { forms: dto });
  }