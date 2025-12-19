// app/api/mobile/v1/forms/[id]/route.ts
  import { jsonOk, jsonError } from '@/lib/api';
  import { resolveTenantFromMobileHeaders } from '@/lib/tenant-mobile';
  import { prisma } from '@/lib/db';

  export async function GET(
    req: Request,
    ctx: { params: { id: string } }
  ) {
    const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
    if (!tenantRes.ok) {
      return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
    }

    const formId = ctx.params.id;

    const form = await prisma.form.findFirst({
      where: {
        id: formId,
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
        config: true,
        theme: true,
      },
    });

    if (!form) {
      return jsonError(req, 404, 'NOT_FOUND', 'Form not found.');
    }

    const fields = await prisma.formField.findMany({
      where: {
        tenantId: tenantRes.tenant.id,
        formId: form.id,
        isActive: true, // ASSUMPTION for mobile: only active fields
      },
      select: {
        key: true,
        label: true,
        type: true,
        required: true,
        placeholder: true,
        helpText: true,
        config: true,
        sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });

    return jsonOk(req, {
      form: {
        id: form.id,
        name: form.name,
        description: form.description ?? null,
        status: form.status,
        groupId: form.groupId ?? null,
        updatedAt: form.updatedAt.toISOString(),
        config: form.config ?? null,
        theme: form.theme ?? null,
      },
      fields: fields.map((f: (typeof fields)[number]) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder ?? null,
        helpText: f.helpText ?? null,
        config: f.config ?? null,
        sortOrder: f.sortOrder,
      })),
    });
  }