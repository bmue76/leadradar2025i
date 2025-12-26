// app/api/admin/v1/forms/[id]/fields/[fieldId]/route.ts
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
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

async function resolveFormId(context: any): Promise<string | null> {
  const params = await resolveParams(context);
  const id = params?.id;
  if (typeof id !== "string") return null;
  const t = id.trim();
  return t.length > 0 ? t : null;
}

async function resolveFieldId(context: any): Promise<string | null> {
  const params = await resolveParams(context);
  const fieldId = params?.fieldId;
  if (typeof fieldId !== "string") return null;
  const t = fieldId.trim();
  return t.length > 0 ? t : null;
}

const KEY_REGEX = /^[A-Za-z0-9_-]+$/;

const FieldTypeSchema = z.enum([
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "PHONE",
  "NUMBER",
  "SELECT",
  "MULTISELECT",
  "CHECKBOX",
  "DATE",
  "DATETIME",
  "URL",
]);

const PatchFieldBodySchema = z
  .object({
    label: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .optional(),
    key: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .refine((s: string) => KEY_REGEX.test(s), { message: "key must match /^[A-Za-z0-9_-]+$/" })
      .optional(),
    type: z
      .preprocess(
        (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        FieldTypeSchema
      )
      .optional(),
    required: z.boolean().optional(),
    isActive: z.boolean().optional(),
    placeholder: z
      .preprocess(
        (v: unknown) => {
          if (v === null) return null;
          if (typeof v === "string") return v.trim();
          return v;
        },
        z.union([z.string(), z.null()])
      )
      .optional(),
    helpText: z
      .preprocess(
        (v: unknown) => {
          if (v === null) return null;
          if (typeof v === "string") return v.trim();
          return v;
        },
        z.union([z.string(), z.null()])
      )
      .optional(),
    sortOrder: z
      .preprocess((v: unknown) => (typeof v === "string" ? Number(v) : v), z.number().int().min(0))
      .optional(),
    config: z.unknown().optional(),
  })
  .strip();

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

export async function PATCH(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  const formId = await resolveFormId(context);
  if (!formId) {
    return jsonError(req, 400, "INVALID_REQUEST", "id (formId) is required");
  }

  const fieldId = await resolveFieldId(context);
  if (!fieldId) {
    return jsonError(req, 400, "INVALID_REQUEST", "fieldId is required");
  }

  try {
    const body = await validateBody(req, PatchFieldBodySchema);

    const data: any = {};
    if (body.label !== undefined) data.label = body.label;
    if (body.key !== undefined) data.key = body.key;
    if (body.type !== undefined) data.type = body.type as any;
    if (body.required !== undefined) data.required = body.required;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.placeholder !== undefined) data.placeholder = body.placeholder;
    if (body.helpText !== undefined) data.helpText = body.helpText;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    if (body.config !== undefined) data.config = body.config;

    if (Object.keys(data).length === 0) {
      throw httpError(400, "INVALID_BODY", "At least one field must be provided.");
    }

    const existing = await prisma.formField.findFirst({
      where: { id: fieldId, tenantId, formId },
      select: { id: true, key: true },
    });
    if (!existing) {
      return jsonError(req, 404, "NOT_FOUND", "Field not found");
    }

    if (data.key && data.key !== existing.key) {
      const conflict = await prisma.formField.findFirst({
        where: { tenantId, formId, key: data.key, NOT: { id: fieldId } },
        select: { id: true },
      });
      if (conflict) {
        return jsonError(req, 409, "KEY_CONFLICT", "Field key already exists for this form");
      }
    }

    const updated = await prisma.formField.update({
      where: { id: fieldId },
      data,
      select: {
        id: true,
        tenantId: true,
        formId: true,
        key: true,
        label: true,
        type: true,
        required: true,
        isActive: true,
        sortOrder: true,
        placeholder: true,
        helpText: true,
        config: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return jsonOk(req, { field: serializeField(updated) });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return jsonError(req, 409, "KEY_CONFLICT", "Field key already exists for this form");
    }
    return handleError(req, err, "Failed to update field");
  }
}

export async function DELETE(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  const formId = await resolveFormId(context);
  if (!formId) {
    return jsonError(req, 400, "INVALID_REQUEST", "id (formId) is required");
  }

  const fieldId = await resolveFieldId(context);
  if (!fieldId) {
    return jsonError(req, 400, "INVALID_REQUEST", "fieldId is required");
  }

  try {
    const existing = await prisma.formField.findFirst({
      where: { id: fieldId, tenantId, formId },
      select: { id: true },
    });
    if (!existing) {
      return jsonError(req, 404, "NOT_FOUND", "Field not found");
    }

    await prisma.formField.delete({ where: { id: fieldId } });
    return jsonOk(req, { deleted: true });
  } catch (err) {
    return handleError(req, err, "Failed to delete field");
  }
}
