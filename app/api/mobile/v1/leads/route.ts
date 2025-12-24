// app/api/mobile/v1/leads/route.ts
import { jsonOk, jsonError } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";
import type { Prisma, LeadAttachmentType } from "@prisma/client";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ALLOWED_TYPES: LeadAttachmentType[] = ["IMAGE", "PDF", "OTHER"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInputJsonValue(v: unknown): Prisma.InputJsonValue | null {
  try {
    // ensures JSON-serializable (no Date/BigInt/functions)
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function safeFilename(name: string) {
  return name.replace(/[/\\]/g, "_").replace(/\s+/g, "_");
}

type LeadPayload = {
  formId: string;
  clientLeadId: string;
  values: Record<string, any>;
  meta?: Record<string, any>;
  capturedAt?: string;
  capturedByDeviceUid?: string;
};

function parseLeadPayload(req: Request, body: unknown): LeadPayload | { error: Response } {
  if (!isRecord(body)) {
    return { error: jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.") };
  }

  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  const clientLeadId = typeof body.clientLeadId === "string" ? body.clientLeadId.trim() : "";

  if (!formId) {
    return { error: jsonError(req, 400, "FORM_ID_REQUIRED", "formId is required.") };
  }
  if (!clientLeadId) {
    return { error: jsonError(req, 400, "CLIENT_LEAD_ID_REQUIRED", "clientLeadId is required.") };
  }

  const valuesRaw = body.values;
  if (!isRecord(valuesRaw)) {
    return { error: jsonError(req, 400, "VALUES_REQUIRED", "values must be an object.") };
  }

  const metaRaw = body.meta;
  let metaObj: Record<string, any> | undefined;
  if (metaRaw !== undefined) {
    if (!isRecord(metaRaw)) {
      return { error: jsonError(req, 400, "META_INVALID", "meta must be an object.") };
    }
    metaObj = metaRaw as Record<string, any>;
  }

  const capturedAtRaw = typeof body.capturedAt === "string" ? body.capturedAt.trim() : "";
  const capturedByDeviceUid =
    typeof body.capturedByDeviceUid === "string" ? body.capturedByDeviceUid.trim() : "";

  return {
    formId,
    clientLeadId,
    values: valuesRaw as Record<string, any>,
    meta: metaObj,
    capturedAt: capturedAtRaw || undefined,
    capturedByDeviceUid: capturedByDeviceUid || undefined,
  };
}

export async function POST(req: Request) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  // NOTE: some typings use ok:boolean (not literal), so we narrow via ok !== true
  if ((tenantRes as any).ok !== true) {
    return jsonError(req, (tenantRes as any).status, (tenantRes as any).code, (tenantRes as any).message);
  }
  const tenant = (tenantRes as any).tenant as { id: string };

  const contentType = req.headers.get("content-type") || "";
  const isMultipart = contentType.toLowerCase().includes("multipart/form-data");

  // ---- 1) Read body (JSON or multipart payload field) ----
  let payload: LeadPayload;
  let file: File | null = null;
  let attachType: LeadAttachmentType = "OTHER";

  if (isMultipart) {
    let fd: any;
    try {
      // do NOT annotate FormData type (avoids TS lib mismatch)
      fd = await req.formData();
    } catch {
      return jsonError(req, 400, "BAD_MULTIPART", "Expected multipart/form-data.");
    }

    const payloadRaw = fd.get("payload");
    const payloadStr = typeof payloadRaw === "string" ? payloadRaw : "";
    if (!payloadStr) {
      return jsonError(req, 400, "PAYLOAD_REQUIRED", "payload (JSON string) is required.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadStr);
    } catch {
      return jsonError(req, 400, "PAYLOAD_BAD_JSON", "payload must be valid JSON.");
    }

    const parsedRes = parseLeadPayload(req, parsed);
    if ("error" in parsedRes) return parsedRes.error;
    payload = parsedRes;

    const typeRaw = fd.get("type");
    const typeStr = typeof typeRaw === "string" ? typeRaw.trim() : "";
    const t = (typeStr || "OTHER") as LeadAttachmentType;
    if (!ALLOWED_TYPES.includes(t)) {
      return jsonError(req, 400, "BAD_TYPE", `type must be one of: ${ALLOWED_TYPES.join(", ")}.`);
    }
    attachType = t;

    const f = fd.get("file");
    if (f instanceof File) {
      file = f;
    } else {
      // multipart is allowed without file (MVP), but scan-flow will include one
      file = null;
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(req, 400, "BAD_JSON", "Invalid JSON body.");
    }

    const parsedRes = parseLeadPayload(req, body);
    if ("error" in parsedRes) return parsedRes.error;
    payload = parsedRes;
  }

  // ---- 2) Validate values/meta are JSON-serializable ----
  const valuesJson = toInputJsonValue(payload.values);
  if (!valuesJson) {
    return jsonError(req, 400, "VALUES_NOT_JSON", "values must be JSON-serializable.");
  }

  let metaJson: Prisma.InputJsonValue | undefined;
  if (payload.meta !== undefined) {
    const m = toInputJsonValue(payload.meta);
    if (!m) {
      return jsonError(req, 400, "META_NOT_JSON", "meta must be JSON-serializable.");
    }
    metaJson = m;
  }

  // ---- 3) Leak-safe form validation (404 if not in tenant OR not active) ----
  const form = await prisma.form.findFirst({
    where: {
      id: payload.formId,
      tenantId: tenant.id,
      status: "ACTIVE",
    },
    select: {
      id: true,
      groupId: true,
    },
  });

  if (!form) {
    return jsonError(req, 404, "NOT_FOUND", "Form not found.");
  }

  // ---- 4) capturedAt parsing ----
  let capturedAt: Date | undefined;
  if (payload.capturedAt) {
    const d = new Date(payload.capturedAt);
    if (Number.isNaN(d.getTime())) {
      return jsonError(req, 400, "BAD_CAPTURED_AT", "capturedAt must be ISO.");
    }
    capturedAt = d;
  }

  // ---- 5) Idempotency check via @@unique([tenantId, clientLeadId]) ----
  const existing = await prisma.lead.findUnique({
    where: {
      tenantId_clientLeadId: {
        tenantId: tenant.id,
        clientLeadId: payload.clientLeadId,
      },
    },
    select: {
      id: true,
      capturedAt: true,
    },
  });

  if (existing) {
    // Important: on retries we do NOT create another attachment (prevents duplicates)
    return jsonOk(req, {
      id: existing.id,
      created: false,
      capturedAt: existing.capturedAt.toISOString(),
      attachment: null,
    });
  }

  // ---- 6) Optional device linkage: tenantId+deviceUid unique ----
  let capturedByDeviceId: string | undefined;
  if (payload.capturedByDeviceUid) {
    const device = await prisma.device.upsert({
      where: {
        tenantId_deviceUid: {
          tenantId: tenant.id,
          deviceUid: payload.capturedByDeviceUid,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        deviceUid: payload.capturedByDeviceUid,
        // ASSUMPTION: platform unknown at this stage; default ANDROID placeholder
        platform: "ANDROID",
      },
      select: { id: true },
    });
    capturedByDeviceId = device.id;
  }

  // ---- 7) Create Lead ----
  const createdLead = await prisma.lead.create({
    data: {
      tenantId: tenant.id,
      formId: form.id,
      groupId: form.groupId ?? null,
      clientLeadId: payload.clientLeadId,
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

  // ---- 8) If multipart file present: create attachment + local storage stub ----
  let createdAttachment: any = null;

  if (file) {
    const filename = file.name || "upload.bin";
    const mimeType = file.type || null;
    const sizeBytes = Number.isFinite(file.size) ? file.size : null;

    // create DB record first (so we have attachmentId for path)
    const att = await prisma.leadAttachment.create({
      data: {
        tenantId: tenant.id,
        leadId: createdLead.id,
        type: attachType,
        filename,
        mimeType,
        sizeBytes,
        storageKey: null,
        url: null,
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

    try {
      const rel = path.posix.join(
        ".tmp_uploads",
        tenant.id,
        createdLead.id,
        `${att.id}_${safeFilename(filename)}`
      );

      const abs = path.join(process.cwd(), rel);
      await mkdir(path.dirname(abs), { recursive: true });

      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeFile(abs, bytes);

      const updated = await prisma.leadAttachment.update({
        where: { id: att.id },
        data: {
          storageKey: rel,
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

      createdAttachment = {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
      };
    } catch {
      // MVP: if local write fails, keep record (still marks "Visitenkarte vorhanden")
      createdAttachment = {
        ...att,
        createdAt: att.createdAt.toISOString(),
      };
    }
  }

  return jsonOk(req, {
    id: createdLead.id,
    created: true,
    capturedAt: createdLead.capturedAt.toISOString(),
    attachment: createdAttachment,
  });
}
