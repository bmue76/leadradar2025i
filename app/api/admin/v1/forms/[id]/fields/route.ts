// app/api/admin/v1/forms/[id]/fields/route.ts
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

export async function POST(req: NextRequest, context: any) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;

  const formId = await resolveFormId(context);
  if (!formId) {
    return jsonError(req, 400, "INVALID_REQUEST", "id (formId) is required");
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const keyRaw = body?.key;
  const labelRaw = body?.label;
  const typeRaw = body?.type;

  if (!isNonEmptyString(keyRaw)) {
    return jsonError(req, 400, "INVALID_REQUEST", "key must be a non-empty string");
  }
  if (!isNonEmptyString(labelRaw)) {
    return jsonError(req, 400, "INVALID_REQUEST", "label must be a non-empty string");
  }
  if (!isNonEmptyString(typeRaw)) {
    return jsonError(req, 400, "INVALID_REQUEST", "type must be a non-empty string");
  }

  const key = keyRaw.trim();
  const label = labelRaw.trim();
  const type = typeRaw.trim().toUpperCase();

  if (!KEY_REGEX.test(key)) {
    return jsonError(
      req,
      400,
      "INVALID_REQUEST",
      'key must match /^[A-Za-z0-9_-]+$/'
    );
  }

  if (!ALLOWED_FIELD_TYPES.has(type)) {
    return jsonError(
      req,
      400,
      "INVALID_REQUEST",
      `type must be one of: ${Array.from(ALLOWED_FIELD_TYPES).join(", ")}`
    );
  }

  const requiredRaw = body?.required;
  const isActiveRaw = body?.isActive;
  const placeholderRaw = body?.placeholder;
  const helpTextRaw = body?.helpText;
  const configRaw = body?.config;

  if (requiredRaw !== undefined && typeof requiredRaw !== "boolean") {
    return jsonError(req, 400, "INVALID_REQUEST", "required must be boolean");
  }
  if (isActiveRaw !== undefined && typeof isActiveRaw !== "boolean") {
    return jsonError(req, 400, "INVALID_REQUEST", "isActive must be boolean");
  }
  if (placeholderRaw !== undefined && placeholderRaw !== null && typeof placeholderRaw !== "string") {
    return jsonError(req, 400, "INVALID_REQUEST", "placeholder must be string or null");
  }
  if (helpTextRaw !== undefined && helpTextRaw !== null && typeof helpTextRaw !== "string") {
    return jsonError(req, 400, "INVALID_REQUEST", "helpText must be string or null");
  }

  // Ensure form exists (tenant-scoped)
  const form = await prisma.form.findFirst({
    where: { id: formId, tenantId },
    select: { id: true },
  });
  if (!form) {
    return jsonError(req, 404, "NOT_FOUND", "Form not found");
  }

  // sortOrder default = last + 1
  const agg = await prisma.formField.aggregate({
    where: { tenantId, formId },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (agg._max.sortOrder ?? -1) + 1;

  try {
    const created = await prisma.formField.create({
      data: {
        tenantId,
        formId,
        key,
        label,
        type: type as any,
        required: requiredRaw ?? false,
        isActive: isActiveRaw ?? true,
        sortOrder: nextSortOrder,
        placeholder: placeholderRaw === undefined ? undefined : (placeholderRaw === null ? null : String(placeholderRaw).trim()),
        helpText: helpTextRaw === undefined ? undefined : (helpTextRaw === null ? null : String(helpTextRaw).trim()),
        config: configRaw === undefined ? undefined : configRaw,
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
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return jsonError(req, 409, "KEY_CONFLICT", "Field key already exists for this form");
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to create field");
  }
}
