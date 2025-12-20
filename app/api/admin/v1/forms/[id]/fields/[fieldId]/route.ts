// app/api/admin/v1/forms/[id]/fields/[fieldId]/route.ts
import { NextRequest } from "next/server";
import { PrismaClient, Prisma } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function resolveParams(context: any): Promise<Record<string, any>> {
  const p = context?.params;
  const paramsObj =
    p && typeof p === "object" && typeof (p as any).then === "function" ? await p : p;
  return (paramsObj && typeof paramsObj === "object") ? paramsObj : {};
}

async function resolveFormId(context: any): Promise<string | null> {
  const params = await resolveParams(context);
  const id = params?.id;
  return isNonEmptyString(id) ? id.trim() : null;
}

async function resolveFieldId(context: any): Promise<string | null> {
  const params = await resolveParams(context);
  const fieldId = params?.fieldId;
  return isNonEmptyString(fieldId) ? fieldId.trim() : null;
}

const KEY_REGEX = /^[A-Za-z0-9_-]+$/;

const ALLOWED_FIELD_TYPES = new Set([
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

function serializeField(f: any) {
  return {
    ...f,
    type: String(f.type),
    createdAt: f.createdAt?.toISOString?.() ?? f.createdAt,
    updatedAt: f.updatedAt?.toISOString?.() ?? f.updatedAt,
  };
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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const data: any = {};

  // label
  if (body?.label !== undefined) {
    if (!isNonEmptyString(body.label)) {
      return jsonError(req, 400, "INVALID_REQUEST", "label must be a non-empty string");
    }
    data.label = body.label.trim();
  }

  // key
  if (body?.key !== undefined) {
    if (!isNonEmptyString(body.key)) {
      return jsonError(req, 400, "INVALID_REQUEST", "key must be a non-empty string");
    }
    const key = body.key.trim();
    if (!KEY_REGEX.test(key)) {
      return jsonError(req, 400, "INVALID_REQUEST", 'key must match /^[A-Za-z0-9_-]+$/');
    }
    data.key = key;
  }

  // type
  if (body?.type !== undefined) {
    if (!isNonEmptyString(body.type)) {
      return jsonError(req, 400, "INVALID_REQUEST", "type must be a non-empty string");
    }
    const type = body.type.trim().toUpperCase();
    if (!ALLOWED_FIELD_TYPES.has(type)) {
      return jsonError(
        req,
        400,
        "INVALID_REQUEST",
        `type must be one of: ${Array.from(ALLOWED_FIELD_TYPES).join(", ")}`
      );
    }
    data.type = type as any;
  }

  // required
  if (body?.required !== undefined) {
    if (typeof body.required !== "boolean") {
      return jsonError(req, 400, "INVALID_REQUEST", "required must be boolean");
    }
    data.required = body.required;
  }

  // isActive
  if (body?.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return jsonError(req, 400, "INVALID_REQUEST", "isActive must be boolean");
    }
    data.isActive = body.isActive;
  }

  // placeholder
  if (body?.placeholder !== undefined) {
    if (body.placeholder === null) {
      data.placeholder = null;
    } else if (typeof body.placeholder === "string") {
      data.placeholder = body.placeholder.trim();
    } else {
      return jsonError(req, 400, "INVALID_REQUEST", "placeholder must be string or null");
    }
  }

  // helpText
  if (body?.helpText !== undefined) {
    if (body.helpText === null) {
      data.helpText = null;
    } else if (typeof body.helpText === "string") {
      data.helpText = body.helpText.trim();
    } else {
      return jsonError(req, 400, "INVALID_REQUEST", "helpText must be string or null");
    }
  }

  // sortOrder
  if (body?.sortOrder !== undefined) {
    const v = body.sortOrder;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return jsonError(req, 400, "INVALID_REQUEST", "sortOrder must be an integer >= 0");
    }
    data.sortOrder = v;
  }

  // config
  if (body?.config !== undefined) {
    data.config = body.config;
  }

  if (Object.keys(data).length === 0) {
    return jsonError(req, 400, "INVALID_REQUEST", "At least one field must be provided");
  }

  // Ensure field exists and is tenant/form scoped
  const existing = await prisma.formField.findFirst({
    where: { id: fieldId, tenantId, formId },
    select: { id: true, key: true },
  });
  if (!existing) {
    return jsonError(req, 404, "NOT_FOUND", "Field not found");
  }

  // key rename uniqueness
  if (data.key && data.key !== existing.key) {
    const conflict = await prisma.formField.findFirst({
      where: { tenantId, formId, key: data.key, NOT: { id: fieldId } },
      select: { id: true },
    });
    if (conflict) {
      return jsonError(req, 409, "KEY_CONFLICT", "Field key already exists for this form");
    }
  }

  try {
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
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(req, 409, "KEY_CONFLICT", "Field key already exists for this form");
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to update field");
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

  const existing = await prisma.formField.findFirst({
    where: { id: fieldId, tenantId, formId },
    select: { id: true },
  });
  if (!existing) {
    return jsonError(req, 404, "NOT_FOUND", "Field not found");
  }

  try {
    await prisma.formField.delete({ where: { id: fieldId } });
    return jsonOk(req, { deleted: true });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to delete field");
  }
}
