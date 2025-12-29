// app/api/mobile/v1/leads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __prismaLR: PrismaClient | undefined;
}

const prisma = global.__prismaLR ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prismaLR = prisma;

type JsonErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

function jsonOk(traceId: string, data: unknown, status = 200) {
  const res = NextResponse.json({ ok: true, data, traceId }, { status });
  res.headers.set("x-trace-id", traceId);
  return res;
}

function jsonError(traceId: string, error: JsonErrorShape, status: number) {
  const res = NextResponse.json({ ok: false, error, traceId }, { status });
  res.headers.set("x-trace-id", traceId);
  return res;
}

function getTraceId(req: NextRequest) {
  const incoming = req.headers.get("x-trace-id")?.trim();
  if (incoming && incoming.length <= 128) return incoming;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6MB
const MAX_CARD_IMAGE_BASE64_CHARS = 8 * 1024 * 1024;

async function readJsonWithLimit(req: NextRequest, maxBytes: number) {
  const ab = await req.arrayBuffer();
  const size = ab.byteLength;

  if (size > maxBytes) {
    return {
      ok: false as const,
      status: 413,
      error: {
        code: "BODY_TOO_LARGE",
        message: `Request body too large (${size} bytes). Max is ${maxBytes}.`,
        details: { maxBytes, gotBytes: size },
      },
    };
  }

  try {
    const text = new TextDecoder("utf-8").decode(ab);
    const json = text.length ? JSON.parse(text) : null;
    return { ok: true as const, json };
  } catch {
    return {
      ok: false as const,
      status: 400,
      error: { code: "INVALID_JSON", message: "Request body is not valid JSON." },
    };
  }
}

// Zod v4: record() braucht keyType + valueType
const JsonRecord = z.record(z.string(), z.unknown());

const LeadPostSchema = z
  .object({
    clientLeadId: z.string().min(3).max(128),
    formId: z.string().min(3).max(128),
    values: JsonRecord.default({}),

    eventId: z.string().min(3).max(128).optional(),
    cardImageBase64: z.string().optional(),
    ocrMeta: z.unknown().optional(),
    meta: JsonRecord.optional(),
  })
  .strict()
  .or(
    z
      .object({
        clientLeadId: z.string().min(3).max(128),
        formId: z.string().min(3).max(128),
        data: JsonRecord,

        eventId: z.string().min(3).max(128).optional(),
        cardImageBase64: z.string().optional(),
        ocrMeta: z.unknown().optional(),
        meta: JsonRecord.optional(),
      })
      .strict()
      .transform((v) => ({ ...v, values: v.data }))
  );

function isPrismaKnownError(e: unknown): e is { code: string; meta?: unknown } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as any).code === "string";
}

function isPrismaInitError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as any).name === "PrismaClientInitializationError";
}

function isPrismaValidationError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as any).name === "PrismaClientValidationError";
}

function devDetails(e: unknown) {
  if (process.env.NODE_ENV === "production") return undefined;
  const err = e as any;
  return {
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
    runtime: process.env.NEXT_RUNTIME ?? "unknown",
  };
}

function getDmmfModels() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmmf: any = (prisma as any)._dmmf;
  return (dmmf?.datamodel?.models ?? []) as any[];
}

function hasModelField(modelName: string, fieldName: string) {
  const models = getDmmfModels();
  const m = models.find((x) => x.name === modelName);
  if (!m) return false;
  return (m.fields ?? []).some((f: any) => f.name === fieldName);
}

function getLeadModel() {
  const models = getDmmfModels();
  return models.find((m: any) => m.name === "Lead");
}

type ScalarField = {
  name: string;
  type: string;
  kind: "scalar";
  isRequired: boolean;
  hasDefaultValue: boolean;
  isId: boolean;
};

function requiredScalarFieldsWithoutDefault(): ScalarField[] {
  const m = getLeadModel();
  if (!m) return [];
  const fields = (m.fields ?? []) as any[];
  return fields
    .filter((f) => f.kind === "scalar")
    .map((f) => f as ScalarField)
    .filter((f) => f.isRequired && !f.hasDefaultValue && !f.isId);
}

function pickEnumValue(enumName: string, preferred: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dmmf: any = (prisma as any)._dmmf;
  const enums = dmmf?.datamodel?.enums ?? [];
  const en = enums.find((x: any) => x.name === enumName);
  const values: string[] = (en?.values ?? []).map((v: any) => v.name);

  for (const p of preferred) if (values.includes(p)) return p;
  return values[0] ?? undefined;
}

export async function POST(req: NextRequest) {
  const traceId = getTraceId(req);

  try {
    if ((process.env.NEXT_RUNTIME ?? "").toLowerCase() === "edge") {
      return jsonError(
        traceId,
        { code: "RUNTIME_EDGE_UNSUPPORTED", message: "This endpoint requires Node.js runtime (Prisma)." },
        500
      );
    }

    const tenantSlug = req.headers.get("x-tenant-slug")?.trim();
    if (!tenantSlug) {
      return jsonError(traceId, { code: "TENANT_MISSING", message: "Missing header: x-tenant-slug" }, 400);
    }

    const parsed = await readJsonWithLimit(req, MAX_BODY_BYTES);
    if (!parsed.ok) return jsonError(traceId, parsed.error, parsed.status);

    const v = LeadPostSchema.safeParse(parsed.json);
    if (!v.success) {
      return jsonError(
        traceId,
        { code: "VALIDATION_FAILED", message: "Payload validation failed.", details: v.error.flatten() },
        422
      );
    }

    const body = v.data as z.infer<typeof LeadPostSchema>;

    if (body.cardImageBase64 && body.cardImageBase64.length > MAX_CARD_IMAGE_BASE64_CHARS) {
      return jsonError(
        traceId,
        {
          code: "CARD_IMAGE_TOO_LARGE",
          message: "cardImageBase64 is too large.",
          details: { maxChars: MAX_CARD_IMAGE_BASE64_CHARS, gotChars: body.cardImageBase64.length },
        },
        413
      );
    }

    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      return jsonError(traceId, { code: "TENANT_INVALID", message: `Unknown tenant slug: ${tenantSlug}` }, 401);
    }

    // ✅ schema-safe Form select
    const formSelect: any = { id: true, status: true };
    if (hasModelField("Form", "eventId")) formSelect.eventId = true;

    const form = await (prisma as any).form.findFirst({
      where: { id: body.formId, tenantId: tenant.id },
      select: formSelect,
    });

    if (!form) {
      return jsonError(
        traceId,
        { code: "FORM_NOT_FOUND", message: "formId not found for this tenant.", details: { formId: body.formId } },
        404
      );
    }

    if (form.status !== "ONLINE") {
      return jsonError(
        traceId,
        { code: "FORM_NOT_ONLINE", message: "Form is not ONLINE.", details: { status: form.status } },
        409
      );
    }

    const existing = await prisma.lead.findFirst({
      where: { tenantId: tenant.id, clientLeadId: body.clientLeadId },
      select: { id: true },
    });

    if (existing) return jsonOk(traceId, { id: existing.id, created: false }, 200);

    const now = new Date();

    const meta = {
      ...(body.meta ?? {}),
      ocrMeta: body.ocrMeta ?? null,
      cardImageProvided: !!body.cardImageBase64,
      userAgent: req.headers.get("user-agent") ?? null,
      receivedAt: now.toISOString(),
    };

    const leadData: Record<string, any> = {
      tenantId: tenant.id,
      formId: body.formId,
      clientLeadId: body.clientLeadId,
      values: body.values ?? {},
      meta,
    };

    const required = requiredScalarFieldsWithoutDefault();
    const requiredNames = new Set(required.map((f) => f.name));

    // eventId nur wenn Lead es wirklich REQUIRED hat (sonst ignorieren)
    if (requiredNames.has("eventId")) {
      const ev = (body as any).eventId ?? (form as any).eventId;
      if (!ev) {
        return jsonError(
          traceId,
          {
            code: "EVENT_REQUIRED",
            message: "Lead requires eventId but none could be resolved.",
            details: { formId: body.formId },
          },
          409
        );
      }
      leadData.eventId = ev;
    }

    if (requiredNames.has("capturedAt")) leadData.capturedAt = now;
    if (requiredNames.has("createdAt")) leadData.createdAt = now;
    if (requiredNames.has("updatedAt")) leadData.updatedAt = now;

    const leadModel = getLeadModel();
    const enumField = (name: string) => leadModel?.fields?.find((f: any) => f.name === name && f.kind === "enum");

    if (requiredNames.has("status")) {
      const ef = enumField("status");
      if (ef?.type) leadData.status = pickEnumValue(String(ef.type), ["NEW", "OPEN", "CAPTURED", "CREATED"]);
    }

    if (requiredNames.has("platform")) {
      const ef = enumField("platform");
      if (ef?.type) {
        leadData.platform = pickEnumValue(
          String(ef.type),
          [String((body as any).meta?.platform ?? "").toUpperCase(), "ANDROID", "IOS", "WEB"].filter(Boolean)
        );
      } else {
        leadData.platform = (body as any).meta?.platform ?? "android";
      }
    }

    if (requiredNames.has("source")) {
      const ef = enumField("source");
      if (ef?.type) leadData.source = pickEnumValue(String(ef.type), ["MOBILE", "APP", "API"]);
    }

    const missing = required.filter((f) => leadData[f.name] === undefined && f.name !== "id");
    if (missing.length) {
      return jsonError(
        traceId,
        {
          code: "SCHEMA_MISMATCH",
          message: "Lead model requires fields that are not provided/resolved by the mobile payload.",
          details: { missing: missing.map((m) => ({ name: m.name, type: m.type })) },
        },
        422
      );
    }

    const created = await prisma.lead.create({
      data: leadData as any,
      select: { id: true },
    });

    return jsonOk(traceId, { id: created.id, created: true }, 200);
  } catch (e) {
    if (isPrismaInitError(e)) {
      console.error("[mobile/v1/leads] prisma init error", { traceId, err: e });
      return jsonError(
        traceId,
        { code: "DB_UNAVAILABLE", message: "Database not reachable / Prisma initialization failed.", details: devDetails(e) },
        503
      );
    }

    if (isPrismaValidationError(e)) {
      console.error("[mobile/v1/leads] prisma validation error", { traceId, err: e });
      return jsonError(
        traceId,
        { code: "PRISMA_VALIDATION", message: "Prisma rejected data shape (schema mismatch).", details: devDetails(e) },
        400
      );
    }

    if (isPrismaKnownError(e)) {
      console.error("[mobile/v1/leads] prisma known error", { traceId, err: e });

      if ((e as any).code === "P2002") {
        return jsonError(
          traceId,
          { code: "DUPLICATE", message: "Lead already exists (unique constraint).", details: (e as any).meta },
          409
        );
      }

      if ((e as any).code === "P2003") {
        return jsonError(
          traceId,
          { code: "INVALID_REFERENCE", message: "Invalid foreign key reference.", details: (e as any).meta },
          400
        );
      }

      return jsonError(
        traceId,
        { code: "PRISMA_ERROR", message: `Database error (${(e as any).code}).`, details: (e as any).meta },
        400
      );
    }

    console.error("[mobile/v1/leads] unhandled error", { traceId, err: e });
    return jsonError(
      traceId,
      { code: "INTERNAL_ERROR", message: "Unexpected server error.", details: devDetails(e) },
      500
    );
  }
}
