  // app/api/mobile/v1/leads/route.ts
  import { jsonOk, jsonError } from '@/lib/api';
  import { resolveTenantFromMobileHeaders } from '@/lib/tenant-mobile';
  import { prisma } from '@/lib/db';
  import type { Prisma } from '@prisma/client';

  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function toInputJsonValue(v: unknown): Prisma.InputJsonValue | null {
    try {
      // ensures JSON-serializable (no Date/BigInt/functions)
      return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
    } catch {
      return null;
    }
  }

  export async function POST(req: Request) {
    const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
    if (!tenantRes.ok) {
      return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(req, 400, 'BAD_JSON', 'Invalid JSON body.');
    }

    if (!isRecord(body)) {
      return jsonError(req, 400, 'BAD_REQUEST', 'Body must be a JSON object.');
    }

    const formId = typeof body.formId === 'string' ? body.formId.trim() : '';
    const clientLeadId =
      typeof body.clientLeadId === 'string' ? body.clientLeadId.trim() : '';

    if (!formId) {
      return jsonError(req, 400, 'FORM_ID_REQUIRED', 'formId is required.');
    }
    if (!clientLeadId) {
      return jsonError(
        req,
        400,
        'CLIENT_LEAD_ID_REQUIRED',
        'clientLeadId is required.'
      );
    }

    const valuesRaw = body.values;
    if (!isRecord(valuesRaw)) {
      return jsonError(req, 400, 'VALUES_REQUIRED', 'values must be an object.');
    }

    const valuesJson = toInputJsonValue(valuesRaw);
    if (!valuesJson) {
      return jsonError(
        req,
        400,
        'VALUES_NOT_JSON',
        'values must be JSON-serializable.'
      );
    }

    const metaRaw = body.meta;
    let metaJson: Prisma.InputJsonValue | undefined;
    if (metaRaw !== undefined) {
      if (!isRecord(metaRaw)) {
        return jsonError(req, 400, 'META_INVALID', 'meta must be an object.');
      }
      const m = toInputJsonValue(metaRaw);
      if (!m) {
        return jsonError(
          req,
          400,
          'META_NOT_JSON',
          'meta must be JSON-serializable.'
        );
      }
      metaJson = m;
    }

    const capturedAtRaw =
      typeof body.capturedAt === 'string' ? body.capturedAt.trim() : '';
    const capturedByDeviceUid =
      typeof body.capturedByDeviceUid === 'string'
        ? body.capturedByDeviceUid.trim()
        : '';

    // leak-safe form validation (404 if not in tenant OR not active)
    const form = await prisma.form.findFirst({
      where: {
        id: formId,
        tenantId: tenantRes.tenant.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        groupId: true,
      },
    });

    if (!form) {
      return jsonError(req, 404, 'NOT_FOUND', 'Form not found.');
    }

    // capturedAt parsing
    let capturedAt: Date | undefined;
    if (capturedAtRaw) {
      const d = new Date(capturedAtRaw);
      if (Number.isNaN(d.getTime())) {
        return jsonError(req, 400, 'BAD_CAPTURED_AT', 'capturedAt must be ISO.');
      }
      capturedAt = d;
    }

    // Idempotency check via @@unique([tenantId, clientLeadId])
    const existing = await prisma.lead.findUnique({
      where: {
        tenantId_clientLeadId: {
          tenantId: tenantRes.tenant.id,
          clientLeadId,
        },
      },
      select: {
        id: true,
        capturedAt: true,
      },
    });

    if (existing) {
      return jsonOk(req, {
        id: existing.id,
        created: false,
        capturedAt: existing.capturedAt.toISOString(),
      });
    }

    // Optional device linkage: tenantId+deviceUid unique
    let capturedByDeviceId: string | undefined;
    if (capturedByDeviceUid) {
      const device = await prisma.device.upsert({
        where: {
          tenantId_deviceUid: {
            tenantId: tenantRes.tenant.id,
            deviceUid: capturedByDeviceUid,
          },
        },
        update: {},
        create: {
          tenantId: tenantRes.tenant.id,
          deviceUid: capturedByDeviceUid,
          // ASSUMPTION: platform unknown at this stage; default ANDROID placeholder
          platform: 'ANDROID',
        },
        select: { id: true },
      });
      capturedByDeviceId = device.id;
    }

    const created = await prisma.lead.create({
      data: {
        tenantId: tenantRes.tenant.id,
        formId: form.id,
        groupId: form.groupId ?? null,
        clientLeadId,
        values: valuesJson,
        meta: metaJson,
        capturedAt: capturedAt ?? undefined,
        capturedByDeviceId: capturedByDeviceId ?? null,
      },
      select: {
        id: true,
        capturedAt: true,
      },
    });

    return jsonOk(req, {
      id: created.id,
      created: true,
      capturedAt: created.capturedAt.toISOString(),
    });
  }