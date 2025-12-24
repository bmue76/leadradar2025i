// app/api/mobile/v1/leads/[id]/attachments/route.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { jsonOk, jsonError } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";
import type { LeadAttachmentType, Prisma } from "@prisma/client";

export const runtime = "nodejs";

const ALLOWED_TYPES: LeadAttachmentType[] = ["IMAGE", "PDF", "OTHER"];

// MVP safety limit (card scan should be small)
const MAX_BYTES = 2_500_000; // 2.5 MB

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function getExtFromMime(mime: string | null | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m === "image/png") return ".png";
  if (m === "image/jpeg" || m === "image/jpg") return ".jpg";
  if (m === "image/webp") return ".webp";
  if (m === "application/pdf") return ".pdf";
  return "";
}

function sha256Hex(bytes: Uint8Array): string {
  // Use Uint8Array (ArrayBufferView) to avoid Buffer typing conflicts
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Next.js can deliver ctx.params as a Promise ("sync dynamic apis").
 * Robust async unwrap + URL fallback.
 */
async function leadIdFromCtxOrUrl(req: Request, ctx?: any): Promise<string> {
  try {
    const p = ctx?.params;
    const params = p && typeof p.then === "function" ? await p : p;
    const id = params?.id;
    if (isNonEmptyString(id)) return id.trim();
  } catch {
    // ignore
  }

  // Fallback: /api/mobile/v1/leads/{id}/attachments
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("leads");
    if (idx >= 0 && parts[idx + 1]) return String(parts[idx + 1]).trim();
  } catch {
    // ignore
  }

  return "";
}

/**
 * role semantics (MVP):
 * - role=BUSINESS_CARD => mark lead.meta.card.present=true
 * - if role missing and type=IMAGE => treat as BUSINESS_CARD (because card scan is always sent)
 */
function normalizeRole(v: unknown): string | null {
  if (!isNonEmptyString(v)) return null;
  const t = v.trim().toUpperCase();
  return t ? t : null;
}

export async function POST(req: Request, ctx: any) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  if (tenantRes.ok !== true) {
    return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
  }
  const tenantId = tenantRes.tenant.id;

  const leadId = await leadIdFromCtxOrUrl(req, ctx);
  if (!leadId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { id: true, meta: true },
  });
  if (!lead) return jsonError(req, 404, "NOT_FOUND", "Lead not found.");

  // IMPORTANT: do not type this as FormData -> avoids TS FormData mismatch errors
  let fd: any;
  try {
    fd = await req.formData();
  } catch {
    return jsonError(req, 400, "BAD_REQUEST", "Expected multipart/form-data.");
  }

  const typeRaw = fd.get("type");
  const type = isNonEmptyString(typeRaw) ? typeRaw.trim().toUpperCase() : "";
  if (!type || !ALLOWED_TYPES.includes(type as LeadAttachmentType)) {
    return jsonError(req, 400, "BAD_REQUEST", `type must be one of: ${ALLOWED_TYPES.join(", ")}`);
  }

  const roleRaw = normalizeRole(fd.get("role"));
  const effectiveRole = roleRaw ?? (type === "IMAGE" ? "BUSINESS_CARD" : null);

  const file = fd.get("file");
  if (!file || typeof file !== "object" || typeof (file as any).arrayBuffer !== "function") {
    return jsonError(req, 400, "BAD_REQUEST", "Missing file.");
  }

  const maybeName = (file as any).name;
  const maybeType = (file as any).type;

  const filename = isNonEmptyString(maybeName) ? safeFilename(maybeName) : "upload";
  const mimeType = isNonEmptyString(maybeType) ? String(maybeType) : null;

  let ab: ArrayBuffer;
  try {
    ab = await (file as any).arrayBuffer();
  } catch {
    return jsonError(req, 400, "BAD_REQUEST", "Unable to read file bytes.");
  }

  const bytes = new Uint8Array(ab);

  if (!bytes.length) return jsonError(req, 400, "BAD_REQUEST", "Empty file.");
  if (bytes.length > MAX_BYTES) {
    return jsonError(req, 413, "PAYLOAD_TOO_LARGE", `File too large (max ${MAX_BYTES} bytes).`);
  }

  const checksum = sha256Hex(bytes);
  const now = new Date();

  // Create DB row first (we want attachment id for storageKey naming)
  const created = await prisma.leadAttachment.create({
    data: {
      tenantId,
      leadId: lead.id,
      type: type as LeadAttachmentType,
      filename,
      mimeType,
      sizeBytes: bytes.length,
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

  // Write local file (MVP storage stub)
  const ext =
    path.extname(filename) ||
    getExtFromMime(mimeType) ||
    (type === "PDF" ? ".pdf" : type === "IMAGE" ? ".png" : "");

  const baseName = safeFilename(path.basename(filename, path.extname(filename)) || "file");
  const fileNameOnDisk = `${created.id}_${baseName}${ext}`;

  const dir = path.join(process.cwd(), ".tmp_uploads", tenantId, lead.id);
  fs.mkdirSync(dir, { recursive: true });

  const absPath = path.join(dir, fileNameOnDisk);
  // Use Uint8Array to avoid Buffer typing conflicts
  fs.writeFileSync(absPath, bytes);

  const storageKey = path
    .join(".tmp_uploads", tenantId, lead.id, fileNameOnDisk)
    .replace(/\\/g, "/");

  const updated = await prisma.leadAttachment.update({
    where: { id: created.id },
    data: { storageKey },
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

  // If this is the mandatory business card snapshot, mark lead.meta.card.present=true
  const isBusinessCard = type === "IMAGE" && effectiveRole === "BUSINESS_CARD";

  if (isBusinessCard) {
    const meta0 = lead.meta;
    const nextMeta: Record<string, any> = isPlainObject(meta0) ? { ...(meta0 as any) } : {};
    const card0 = isPlainObject(nextMeta.card) ? { ...nextMeta.card } : {};

    nextMeta.card = {
      ...card0,
      required: true,
      present: true,
      attachmentId: updated.id,
      filename: updated.filename ?? null,
      mimeType: updated.mimeType ?? null,
      sizeBytes: updated.sizeBytes ?? null,
      updatedAt: now.toISOString(),
    };

    try {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { meta: nextMeta as Prisma.InputJsonValue },
      });
    } catch {
      // ignore (best effort)
    }
  }

  return jsonOk(req, { ...updated, role: effectiveRole });
}
