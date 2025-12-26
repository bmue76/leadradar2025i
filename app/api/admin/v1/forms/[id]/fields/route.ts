// app/api/admin/v1/forms/[id]/fields/route.ts
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";
import { isHttpError, validateBody } from "@/lib/http";

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

const CreateFieldBodySchema = z
  .object({
    key: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .refine((s: string) => KEY_REGEX.test(s), { message: "key must match /^[A-Za-z0-9_-]+$/" }),
    label: z.preprocess(
      (v: unknown) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1)
    ),
    type: z.preprocess(
      (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v),
      FieldTypeSchema
    ),
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

export async function POST(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  const formId = await resolveFormId(context);
  if (!formId) {
    return jsonError(req, 400, "INVALID_REQUEST", "id (formId) is required");
  }

  try {
    const body = await validateBody(req, CreateFieldBodySchema);

    const form = await prisma.form.findFirst({
      where: { id: formId, tenantId },
      select: { id: true },
    });
    if (!form) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found");
    }

    const agg = await prisma.formField.aggregate({
      where: { tenantId, formId },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (agg._max.sortOrder ?? -1) + 1;

    const configValue =
      body.config === undefined
        ? undefined
        : body.config === null
          ? Prisma.JsonNull
          : (body.config as Prisma.InputJsonValue);

    const created = await prisma.formField.create({
      data: {
        tenantId,
        formId,
        key: body.key,
        label: body.label,
        type: body.type as any,
        required: body.required ?? false,
        isActive: body.isActive ?? true,
        sortOrder: nextSortOrder,
        placeholder: body.placeholder === undefined ? undefined : body.placeholder,
        helpText: body.helpText === undefined ? undefined : body.helpText,
        config: configValue,
      },
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

    return jsonOk(req, { field: serializeField(created) }, { status: 201 });
  } catch (err) {
    return handleError(req, err, "Failed to create field");
  }
}
