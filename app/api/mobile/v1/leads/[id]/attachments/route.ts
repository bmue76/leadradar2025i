// app/api/mobile/v1/leads/[id]/attachments/route.ts
  import { jsonOk, jsonError } from '@/lib/api';
  import { resolveTenantFromMobileHeaders } from '@/lib/tenant-mobile';
  import { prisma } from '@/lib/db';
  import type { LeadAttachmentType } from '@prisma/client';

  const ALLOWED_TYPES: LeadAttachmentType[] = ['IMAGE', 'PDF', 'OTHER'];

  export async function POST(
    req: Request,
    ctx: { params: { id: string } }
  ) {
    const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
    if (!tenantRes.ok) {
      return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
    }

    const leadId = ctx.params.id;

    // leak-safe: lead must belong to tenant
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId: tenantRes.tenant.id },
      select: { id: true },
    });

    if (!lead) {
      return jsonError(req, 404, 'NOT_FOUND', 'Lead not found.');
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonError(
        req,
        400,
        'BAD_MULTIPART',
        'Expected multipart/form-data.'
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return jsonError(req, 400, 'FILE_REQUIRED', 'file is required.');
    }

    const typeRaw = formData.get('type');
    const typeStr = typeof typeRaw === 'string' ? typeRaw.trim() : '';
    const type: LeadAttachmentType = (typeStr || 'OTHER') as LeadAttachmentType;

    if (!ALLOWED_TYPES.includes(type)) {
      return jsonError(
        req,
        400,
        'BAD_TYPE',
        `type must be one of: ${ALLOWED_TYPES.join(', ')}.`
      );
    }

    const filename = file.name || null;
    const mimeType = file.type || null;
    const sizeBytes = Number.isFinite(file.size) ? file.size : null;

    const created = await prisma.leadAttachment.create({
      data: {
        tenantId: tenantRes.tenant.id,
        leadId: lead.id,
        type,
        filename,
        mimeType,
        sizeBytes,
        // storageKey/url intentionally null (1.5 stub)
      },
      select: {
        id: true,
        type: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        url: true,
        createdAt: true,
      },
    });

    return jsonOk(req, {
      id: created.id,
      type: created.type,
      filename: created.filename,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      storageKey: created.storageKey,
      url: created.url,
      createdAt: created.createdAt.toISOString(),
    });
  }