// app/api/admin/v1/forms/from-template/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";
import { httpError, isHttpError, validateBody } from "@/lib/http";

export const runtime = "nodejs";

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

const CreateFromTemplateBodySchema = z
  .object({
    templateId: z.preprocess(
      (v: unknown) => (typeof v === "string" ? v.trim() : v),
      z.string().min(1)
    ),
    name: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .optional(),
    groupId: z
      .preprocess((v: unknown) => (typeof v === "string" ? v.trim() : v), z.string().min(1))
      .optional(),
  })
  .strip();

type TemplateDefinition = {
  config?: { theme?: any; [k: string]: any };
  theme?: any;
  fields?: Array<{
    key: string;
    label: string;
    type: string;
    required?: boolean;
    config?: any;
    sortOrder?: number;
  }>;
};

function handleError(req: Request, err: unknown, fallbackMessage: string) {
  if (isHttpError(err)) {
    return jsonError(req, err.status, err.code, err.message, err.details);
  }
  return jsonError(req, 500, "INTERNAL_ERROR", fallbackMessage);
}

export async function POST(req: NextRequest) {
  const auth = await requireTenantContext(req);
  if (!auth.ok) return auth.res;

  const tenantId = auth.ctx.tenantId;
  const userId = auth.ctx.user.id;

  try {
    const body = await validateBody(req, CreateFromTemplateBodySchema);

    const templateId = body.templateId;
    const name = body.name ?? null;
    const groupId = body.groupId ?? null;

    if (groupId) {
      const g = await prisma.group.findFirst({
        where: { id: groupId, tenantId },
        select: { id: true },
      });
      if (!g) {
        return jsonError(req, 404, "NOT_FOUND", "Group not found");
      }
    }

    const tpl = await prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        OR: [{ kind: "SYSTEM", tenantId: null }, { kind: "TENANT", tenantId }],
      },
      select: { id: true, name: true, definition: true },
    });

    if (!tpl) {
      return jsonError(req, 404, "NOT_FOUND", "Template not found");
    }

    const def = (tpl.definition ?? {}) as TemplateDefinition;
    const theme = def?.config?.theme ?? def?.theme ?? null;
    const config = theme ? { theme } : {};

    const fields = Array.isArray(def?.fields) ? def.fields : [];

    const normalizedFields = fields.map((f, idx) => {
      const key = String(f.key ?? "").trim();
      const label = String(f.label ?? "").trim();
      const type = String(f.type ?? "").trim().toUpperCase();

      return {
        key,
        label,
        type,
        required: Boolean(f.required),
        config: f.config ?? {},
        sortOrder: idx + 1,
      };
    });

    for (const f of normalizedFields) {
      if (!f.key || !f.label || !f.type) {
        throw httpError(400, "INVALID_TEMPLATE", "Template has invalid fields.");
      }
      if (!KEY_REGEX.test(f.key)) {
        throw httpError(400, "INVALID_TEMPLATE", "Template field key is invalid.", { key: f.key });
      }
      const typeCheck = FieldTypeSchema.safeParse(f.type);
      if (!typeCheck.success) {
        throw httpError(400, "INVALID_TEMPLATE", "Template field type is invalid.", { type: f.type });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const form = await tx.form.create({
        data: {
          tenantId,
          templateId: tpl.id,
          name: name ?? tpl.name,
          status: "DRAFT",
          groupId,
          createdByUserId: userId,
          config,
        },
        select: { id: true },
      });

      if (normalizedFields.length > 0) {
        await tx.formField.createMany({
          data: normalizedFields.map((f) => ({
            tenantId,
            formId: form.id,
            key: f.key,
            label: f.label,
            type: f.type as any,
            required: f.required,
            isActive: true,
            config: f.config,
            sortOrder: f.sortOrder,
          })),
        });
      }

      try {
        await (tx as any).auditEvent?.create?.({
          data: {
            tenantId,
            actorType: "USER",
            actorUserId: userId,
            action: "FORM_CREATED_FROM_TEMPLATE",
            entityType: "FORM",
            entityId: form.id,
            meta: { templateId: tpl.id },
          },
        });
      } catch {}

      return form;
    });

    return jsonOk(req, { id: created.id });
  } catch (err) {
    return handleError(req, err, "Failed to create form from template");
  }
}
