// app/api/mobile/v1/leads/route.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { jsonOk, jsonError } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isHttpError, validateBody } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInputJsonValue(v: unknown): Prisma.InputJsonValue | null {
  try {
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

function safeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function extFromMime(mimeType: string): string {
  const t = mimeType.trim().toLowerCase();
  if (t === "image/png") return ".png";
  if (t === "image/jpeg" || t === "image/jpg") return ".jpg";
  if (t === "image/webp") return ".webp";
  if (t === "application/pdf") return ".pdf";
  return "";
}

function stripDataUrlPrefix(b64: string): { mimeType?: string; base64: string } {
  const t = b64.trim();
  if (!t.startsWith("data:")) return { base64: t };

  // data:image/png;base64,AAAA
  const idx = t.indexOf(",");
  if (idx < 0) return { base64: t };
  const header = t.slice(0, idx);
  const payload = t.slice(idx + 1);

  const m = header.match(/^data:([^;]+);base64$/i);
  return { mimeType: m?.[1]?.trim(), base64: payload.trim() };
}

type ParsedCardImage = {
  mimeType: string;
  filename: string;
  bytes: Uint8Array;
};

function parseCardImage(
  body: Record<string, unknown>
):
  | { ok: true; img: ParsedCardImage }
  | { ok: false; code: string; message: string }
  | { ok: true; img: null } {
  // Accept shapes:
  // - cardImageBase64: "data:image/png;base64,..."
  // - cardImage: { base64, mimeType?, filename? }
  const rawBase64 =
    typeof body.cardImageBase64 === "string"
      ? body.cardImageBase64
      : isRecord(body.cardImage) && typeof (body.cardImage as any).base64 === "string"
        ? String((body.cardImage as any).base64)
        : "";

  if (!rawBase64.trim()) return { ok: true, img: null };

  const stripped = stripDataUrlPrefix(rawBase64);

  const mimeFromObj =
    isRecord(body.cardImage) && typeof (body.cardImage as any).mimeType === "string"
      ? String((body.cardImage as any).mimeType).trim()
      : "";

  const mimeType = (mimeFromObj || stripped.mimeType || "image/jpeg").trim();
  if (!mimeType) return { ok: false, code: "CARD_MIME_REQUIRED", message: "cardImage mimeType missing." };

  const fnFromObj =
    isRecord(body.cardImage) && typeof (body.cardImage as any).filename === "string"
      ? String((body.cardImage as any).filename).trim()
      : "";

  // default filename
  const ext = extFromMime(mimeType);
  const filename = safeFilename(fnFromObj || `business_card${ext || ".jpg"}`);

  let bytes: Uint8Array;
  try {
    // IMPORTANT: avoid Buffer typing issues by copying into a real Uint8Array
    bytes = Uint8Array.from(Buffer.from(stripped.base64, "base64"));
  } catch {
    return { ok: false, code: "CARD_BASE64_INVALID", message: "cardImage base64 is invalid." };
  }

  // Safety limit (MVP): 1.5MB should be plenty for ~150dpi BW
  if (bytes.byteLength <= 0) {
    return { ok: false, code: "CARD_EMPTY", message: "cardImage is empty." };
  }
  if (bytes.byteLength > 1_500_000) {
    return {
      ok: false,
      code: "CARD_TOO_LARGE",
      message: "cardImage too large (>1.5MB). Please reduce resolution/compression.",
    };
  }

  return { ok: true, img: { mimeType, filename, bytes } };
}

function mergeCardMeta(
  metaJson: Prisma.InputJsonValue | undefined,
  nowIso: string,
  present: boolean
) {
  const base: Record<string, any> = metaJson && isRecord(metaJson) ? { ...(metaJson as any) } : {};
  const card0: Record<string, any> = isRecord(base.card) ? { ...(base.card as any) } : {};

  base.card = {
    ...card0,
    required: true,
    present: present === true ? true : Boolean(card0.present) === true,
    updatedAt: nowIso,
  };

  return base as Prisma.InputJsonValue;
}

async function hasBusinessCardAttachment(tenantId: string, leadId: string) {
  const n = await prisma.leadAttachment.count({
    where: {
      tenantId,
      leadId,
      OR: [{ type: "IMAGE" }, { type: "PDF" }],
    },
  });
  return n > 0;
}

async function createBusinessCardAttachment(args: {
  tenantId: string;
  leadId: string;
  mimeType: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const checksum = crypto.createHash("sha256").update(args.bytes).digest("hex");
  const sizeBytes = args.bytes.byteLength;

  // Create DB row first (we need the id for the filename)
  const created = await prisma.leadAttachment.create({
    data: {
      tenantId: args.tenantId,
      leadId: args.leadId,
      type: "IMAGE",
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes,
      checksum,
      storageKey: null,
      url: null,
    },
    select: {
      id: true,
      type: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      storageKey: true,
      url: true,
      createdAt: true,
    },
  });

  const tenantDir = path.join(process.cwd(), ".tmp_uploads", args.tenantId);
  const leadDir = path.join(tenantDir, args.leadId);
  fs.mkdirSync(leadDir, { recursive: true });

  const finalName = `${created.id}_${safeFilename(args.filename)}`;
  const filePath = path.join(leadDir, finalName);

  try {
    fs.writeFileSync(filePath, args.bytes);
  } catch (e) {
    // best effort rollback
    try {
      await prisma.leadAttachment.delete({ where: { id: created.id } });
    } catch {
      // ignore
    }
    throw e;
  }

  const updated = await prisma.leadAttachment.update({
    where: { id: created.id },
    data: { storageKey: filePath },
    select: {
      id: true,
      type: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      storageKey: true,
      url: true,
      createdAt: true,
    },
  });

  return {
    id: updated.id,
    type: updated.type,
    filename: updated.filename ?? null,
    mimeType: updated.mimeType ?? null,
    sizeBytes: updated.sizeBytes ?? null,
    storageKey: updated.storageKey ?? null,
    url: updated.url ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function POST(req: Request) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  if (tenantRes.ok !== true) {
    return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
  }
  const tenantId = tenantRes.tenant.id;

  try {
    // IMPORTANT: base64 card image makes bodies bigger than 512KB
    const body = await validateBody(req, z.any(), { maxBytes: 4 * 1024 * 1024 });

    if (!isRecord(body)) {
      return jsonError(req, 400, "BAD_REQUEST", "Body must be a JSON object.");
    }

    const formId = typeof body.formId === "string" ? body.formId.trim() : "";
    const clientLeadId = typeof body.clientLeadId === "string" ? body.clientLeadId.trim() : "";

    if (!formId) return jsonError(req, 400, "FORM_ID_REQUIRED", "formId is required.");
    if (!clientLeadId)
      return jsonError(req, 400, "CLIENT_LEAD_ID_REQUIRED", "clientLeadId is required.");

    const valuesRaw = body.values;
    if (!isRecord(valuesRaw)) return jsonError(req, 400, "VALUES_REQUIRED", "values must be an object.");

    const valuesJson = toInputJsonValue(valuesRaw);
    if (!valuesJson) return jsonError(req, 400, "VALUES_NOT_JSON", "values must be JSON-serializable.");

    // optional meta (object only)
    const metaRaw = (body as any).meta;
    let metaJson: Prisma.InputJsonValue | undefined;
    if (metaRaw !== undefined) {
      if (!isRecord(metaRaw)) return jsonError(req, 400, "META_INVALID", "meta must be an object.");
      const m = toInputJsonValue(metaRaw);
      if (!m) return jsonError(req, 400, "META_NOT_JSON", "meta must be JSON-serializable.");
      metaJson = m;
    }

    // Parse inline card image (MVP: base64)
    const cardParsed = parseCardImage(body);
    if (!cardParsed.ok) {
      return jsonError(req, 400, cardParsed.code, cardParsed.message);
    }

    const capturedAtRaw =
      typeof (body as any).capturedAt === "string" ? String((body as any).capturedAt).trim() : "";
    const capturedByDeviceUid =
      typeof (body as any).capturedByDeviceUid === "string"
        ? String((body as any).capturedByDeviceUid).trim()
        : "";

    // leak-safe form validation (404 if not in tenant OR not active)
    const form = await prisma.form.findFirst({
      where: { id: formId, tenantId, status: "ACTIVE" },
      select: { id: true, groupId: true },
    });
    if (!form) return jsonError(req, 404, "NOT_FOUND", "Form not found.");

    // capturedAt parsing
    let capturedAt: Date | undefined;
    if (capturedAtRaw) {
      const d = new Date(capturedAtRaw);
      if (Number.isNaN(d.getTime())) return jsonError(req, 400, "BAD_CAPTURED_AT", "capturedAt must be ISO.");
      capturedAt = d;
    }

    // Idempotency: existing lead
    const existing = await prisma.lead.findUnique({
      where: { tenantId_clientLeadId: { tenantId, clientLeadId } },
      select: { id: true, capturedAt: true, meta: true },
    });

    const nowIso = new Date().toISOString();

    if (existing) {
      let present = await hasBusinessCardAttachment(tenantId, existing.id);

      // If client re-sends inline card image and lead has no card yet -> attach now
      if (!present && cardParsed.img) {
        await createBusinessCardAttachment({
          tenantId,
          leadId: existing.id,
          mimeType: cardParsed.img.mimeType,
          filename: cardParsed.img.filename,
          bytes: cardParsed.img.bytes,
        });
        present = true;

        // update meta.card.present
        const metaWithCard = mergeCardMeta((existing.meta as any) ?? undefined, nowIso, true);
        await prisma.lead.update({ where: { id: existing.id }, data: { meta: metaWithCard } });
      }

      return jsonOk(req, {
        id: existing.id,
        created: false,
        capturedAt: existing.capturedAt.toISOString(),
        attachment: { required: true, present },
      });
    }

    // Optional device linkage: tenantId+deviceUid unique
    let capturedByDeviceId: string | undefined;
    if (capturedByDeviceUid) {
      const device = await prisma.device.upsert({
        where: { tenantId_deviceUid: { tenantId, deviceUid: capturedByDeviceUid } },
        update: {},
        create: {
          tenantId,
          deviceUid: capturedByDeviceUid,
          platform: "ANDROID", // MVP default
        },
        select: { id: true },
      });
      capturedByDeviceId = device.id;
    }

    // every lead starts with card required; present flips to true once saved
    const metaWithCardRequired = mergeCardMeta(metaJson, nowIso, false);

    const created = await prisma.lead.create({
      data: {
        tenantId,
        formId: form.id,
        groupId: form.groupId ?? null,
        clientLeadId,
        values: valuesJson,
        meta: metaWithCardRequired,
        capturedAt: capturedAt ?? undefined,
        capturedByDeviceId: capturedByDeviceId ?? null,
      },
      select: { id: true, capturedAt: true },
    });

    let present = false;
    let attachmentDto: any = null;

    if (cardParsed.img) {
      attachmentDto = await createBusinessCardAttachment({
        tenantId,
        leadId: created.id,
        mimeType: cardParsed.img.mimeType,
        filename: cardParsed.img.filename,
        bytes: cardParsed.img.bytes,
      });
      present = true;

      // update meta.card.present
      const metaPresent = mergeCardMeta(metaJson, new Date().toISOString(), true);
      await prisma.lead.update({ where: { id: created.id }, data: { meta: metaPresent } });
    }

    return jsonOk(req, {
      id: created.id,
      created: true,
      capturedAt: created.capturedAt.toISOString(),
      attachment: { required: true, present },
      attachmentSaved: attachmentDto ?? null,
    });
  } catch (err) {
    if (isHttpError(err)) {
      return jsonError(req, err.status, err.code, err.message, err.details);
    }
    console.error("mobile lead create failed", err);
    return jsonError(req, 500, "INTERNAL_ERROR", "Unexpected error.");
  }
}
