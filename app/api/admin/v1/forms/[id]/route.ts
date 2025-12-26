// app/api/admin/v1/forms/[id]/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";
import { httpError, isHttpError, validateBody } from "@/lib/http";

export const runtime = "nodejs";

async function resolveParams(context: any): Promise<Record<string, any>> {
  const p = context?.params;
  const paramsObj =
    p && typeof p === "object" && typeof (p as any).then === "function" ? await p : p;
  return paramsObj && typeof paramsObj === "object" ? paramsObj : {};
}

async function resolveIdParam(context: any): Promise<string | null> {
  const params = await resolveParams(context);
  const id = params?.id;
  if (typeof id !== "string") return null;
  const t = id.trim();
  return t.length > 0 ? t : null;
}

function serializeForm(form: any) {
  return {
    ...form,
    status: String(form.status),
    createdAt: form.createdAt?.toISOString?.() ?? form.createdAt,
    updatedAt: form.updatedAt?.toISOString?.() ?? form.updatedAt,
  };
}

function serializeField(f: any) {
  return {
    ...f,
    type: String(f.type),
    createdAt: f.createdAt?.toISOString?.() ?? f.createdAt,
    updatedAt: f.updatedAt?.toISOString?.() ?? f.updatedAt,
  };
}

function handleError(req: Request, err: unknown, fallbackMessage: string) {
  if (isHttpError(err)) {
    return jsonError(req, err.status, err.code, err.message, err.details);
  }
  return jsonError(req, 500, "INTERNAL_ERROR", fallbackMessage);
}

const PatchFormBodySchema = z
  .object({
    status: z
      .preprocess(
        (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.enum(["DRAFT", "ACTIVE", "ARCHIVED"])
      )
      .optional(),
    name: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .optional(),
    description: z
      .preprocess(
        (v: unknown) => {
          if (v === null) return null;
          if (typeof v === "string") return v.trim();
          return v;
        },
        z.union([z.string(), z.null()])
      )
      .optional(),
  })
  .strip();

export async function GET(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  const id = await resolveIdParam(context);
  if (!id) {
    return jsonError(req, 400, "INVALID_REQUEST", "id is required");
  }

  try {
    const form = await prisma.form.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        templateId: true,
        groupId: true,
        name: true,
        status: true,
        config: true,
        createdAt: true,
        updatedAt: true,
        createdByUserId: true,
      },
    });

    if (!form) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found");
    }

    const fields = await prisma.formField.findMany({
      where: { formId: form.id, tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        formId: true,
        key: true,
        label: true,
        type: true,
        required: true,
        isActive: true,
        placeholder: true,
        helpText: true,
        config: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk(req, {
      form: serializeForm(form),
      fields: fields.map(serializeField),
    });
  } catch (err) {
    return handleError(req, err, "Failed to load form");
  }
}

export async function PATCH(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;
  const userId = auth.ctx.user.id;

  const id = await resolveIdParam(context);
  if (!id) {
    return jsonError(req, 400, "INVALID_REQUEST", "id is required");
  }

  try {
    const body = await validateBody(req, PatchFormBodySchema);

    const data: any = {};
    if (body.status !== undefined) data.status = body.status as any;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;

    if (Object.keys(data).length === 0) {
      throw httpError(400, "INVALID_BODY", "At least one field must be provided.");
    }

    const existing = await prisma.form.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found");
    }

    let updated: any;
    try {
      updated = await prisma.form.update({
        where: { id },
        data: data as any,
        select: {
          id: true,
          tenantId: true,
          templateId: true,
          groupId: true,
          name: true,
          status: true,
          config: true,
          createdAt: true,
          updatedAt: true,
          createdByUserId: true,
        },
      });
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "";
      if (data.description !== undefined && msg.includes("Unknown arg") && msg.includes("description")) {
        throw httpError(400, "INVALID_BODY", "Field 'description' is not supported by the server.");
      }
      throw e;
    }

    // AuditEvent (best-effort)
    try {
      const fromStatus = String(existing.status);
      const toStatus = String(updated.status);

      if (data.status && fromStatus !== toStatus) {
        await (prisma as any).auditEvent?.create?.({
          data: {
            tenantId,
            actorUserId: userId,
            type: "FORM_STATUS_CHANGED",
            entityType: "FORM",
            entityId: id,
            meta: { from: fromStatus, to: toStatus },
          },
        });
      }
    } catch {
      // best-effort: never fail request
    }

    return jsonOk(req, { form: serializeForm(updated) });
  } catch (err) {
    return handleError(req, err, "Failed to update form");
  }
}
