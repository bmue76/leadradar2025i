// app/api/admin/v1/forms/from-template/route.ts
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { jsonOk, jsonError } from "@/lib/api";
import { requireTenantContext } from "@/lib/auth";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function resolveTenantAndUser(req: NextRequest, ctx: any): Promise<{
  tenantId: string | null;
  userId: string | null;
}> {
  const headerUserId = req.headers.get("x-user-id");

  const userId: string | null =
    (isNonEmptyString(ctx?.userId) && ctx.userId) ||
    (isNonEmptyString(ctx?.user?.id) && ctx.user.id) ||
    (isNonEmptyString(headerUserId) && headerUserId) ||
    null;

  let tenantId: string | null =
    (isNonEmptyString(ctx?.tenantId) && ctx.tenantId) ||
    (isNonEmptyString(ctx?.tenant?.id) && ctx.tenant.id) ||
    (isNonEmptyString(ctx?.tenant) && ctx.tenant) ||
    null;

  // Fallback: Tenant via User (wichtig, weil requireTenantContext ctx.tenantId evtl. nicht setzt)
  if (!tenantId && userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    tenantId = u?.tenantId ?? null;
  }

  return { tenantId, userId };
}

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

export async function POST(req: NextRequest) {
  const ctx = await requireTenantContext(req);
  if (ctx instanceof Response) return ctx;

  const { tenantId, userId } = await resolveTenantAndUser(req, ctx);
  if (!tenantId) {
    return jsonError(req, 403, "TENANT_REQUIRED", "Tenant context required");
  }
  if (!userId) {
    return jsonError(req, 401, "UNAUTHORIZED", "Missing x-user-id");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "INVALID_REQUEST", "Invalid JSON body");
  }

  const templateId = body?.templateId;
  const nameInput = body?.name;
  const groupIdInput = body?.groupId;

  if (!isNonEmptyString(templateId)) {
    return jsonError(req, 400, "INVALID_REQUEST", "templateId is required");
  }

  const name: string | null = isNonEmptyString(nameInput) ? nameInput.trim() : null;
  const groupId: string | null = isNonEmptyString(groupIdInput) ? groupIdInput.trim() : null;

  // Group validation (leak-prevention)
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
      id: templateId.trim(),
      OR: [{ kind: "SYSTEM", tenantId: null }, { kind: "TENANT", tenantId }],
    },
    select: {
      id: true,
      name: true,
      definition: true,
    },
  });

  if (!tpl) {
    return jsonError(req, 404, "NOT_FOUND", "Template not found");
  }

  const def = (tpl.definition ?? {}) as TemplateDefinition;
  const theme = def?.config?.theme ?? def?.theme ?? null;
  const config = theme ? { theme } : {};

  const fields = Array.isArray(def?.fields) ? def.fields : [];
  const normalizedFields = fields.map((f, idx) => ({
    key: String(f.key ?? "").trim(),
    label: String(f.label ?? "").trim(),
    type: String(f.type ?? "").trim(),
    required: Boolean(f.required),
    config: f.config ?? {},
    sortOrder:
      typeof f.sortOrder === "number" && Number.isFinite(f.sortOrder) ? f.sortOrder : idx + 1,
  }));

  if (normalizedFields.some((f) => !f.key || !f.label || !f.type)) {
    return jsonError(req, 400, "INVALID_TEMPLATE", "Template has invalid fields");
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const form = await tx.form.create({
        data: {
          tenantId,
          templateId: tpl.id,
          name: name ?? tpl.name,
          status: "DRAFT", // ASSUMPTION gemäss Spec
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
            config: f.config,
            sortOrder: f.sortOrder,
          })),
        });
      }

      // AuditEvent (best effort)
      try {
        // @ts-ignore
        await tx.auditEvent.create({
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
      } catch {
        // ignore if model differs
      }

      return form;
    });

    return jsonOk(req, { id: created.id });
  } catch {
    return jsonError(req, 500, "INTERNAL_ERROR", "Failed to create form from template");
  }
}
