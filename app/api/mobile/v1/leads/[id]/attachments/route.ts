// app/api/mobile/v1/leads/[id]/attachments/route.ts
import fs from "node:fs";
import path from "node:path";

import { jsonOk, jsonError } from "@/lib/api";
import { resolveTenantFromMobileHeaders } from "@/lib/tenant-mobile";
import { prisma } from "@/lib/db";
import type { LeadAttachmentType } from "@prisma/client";

export const runtime = "nodejs";

const ALLOWED_TYPES: LeadAttachmentType[] = ["IMAGE", "PDF", "OTHER"];

function safeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function leadIdFromCtxOrUrl(req: Request, ctx?: { params?: { id?: string } }): string {
  const fromCtx = ctx?.params?.id;
  if (typeof fromCtx === "string" && fromCtx.trim()) return fromCtx.trim();

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

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const tenantRes = await resolveTenantFromMobileHeaders(prisma, req.headers);
  if (!tenantRes.ok) {
    return jsonError(req, tenantRes.status, tenantRes.code, tenantRes.message);
  }
  // TS narrowing helper (TenantResolveResult is not discriminated well)
  const tenant = (tenantRes as any).tenant as { id: string };

  const leadId = leadIdFromCtxOrUrl(req, ctx);
  if (!leadId) {
    return jsonError(req, 400, "INVALID_PARAMS", "Missing lead id.");
  }

  // leak-safe: lead must belong to tenant
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId: tenant.id },
    select: { id: true },
  });

  if (!lead) {
    return jsonError(req, 404, "NOT_FOUND", "Lead not found.");
  }

  let formData: any;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(req, 400, "BAD_MULTIPART", "Expected multipart/form-data.");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(req, 400, "FILE_REQUIRED", "file is required.");
  }

  const typeRaw = formData.get("type");
  const typeStr = typeof typeRaw === "string" ? typeRaw.trim() : "";
  const type = (typeStr || "OTHER") as LeadAttachmentType;

  if (!ALLOWED_TYPES.includes(type)) {
    return jsonError(req, 400, "BAD_TYPE", `type must be one of: ${ALLOWED_TYPES.join(", ")}.`);
  }

  const filename = file.name ? safeFilename(file.name) : null;
  const mimeType = file.type || null;
  const sizeBytes = Number.isFinite((file as any).size) ? Number((file as any).size) : null;

  // Create DB record first to obtain attachmentId
  const created = await prisma.leadAttachment.create({
    data: {
      tenantId: tenant.id,
      leadId: lead.id,
      type,
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

  // Local storage stub
  try {
    const baseDir = path.join(process.cwd(), ".tmp_uploads", tenant.id, lead.id);
    fs.mkdirSync(baseDir, { recursive: true });

    const namePart = filename ? safeFilename(filename) : "upload.bin";
    const diskName = `${created.id}_${namePart}`;
    const absPath = path.join(baseDir, diskName);

    // Use Uint8Array to avoid Buffer typing issues
    const bytes = new Uint8Array(await file.arrayBuffer());
    fs.writeFileSync(absPath, bytes);

    const storageKey = path
      .join(".tmp_uploads", tenant.id, lead.id, diskName)
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
        storageKey: true,
        url: true,
        createdAt: true,
      },
    });

    return jsonOk(req, {
      id: updated.id,
      type: updated.type,
      filename: updated.filename,
      mimeType: updated.mimeType,
      sizeBytes: updated.sizeBytes,
      storageKey: updated.storageKey,
      url: updated.url,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (e: any) {
    // Best effort cleanup
    try {
      await prisma.leadAttachment.delete({ where: { id: created.id } });
    } catch {
      // ignore
    }
    return jsonError(req, 500, "STORAGE_FAILED", String(e?.message || "Failed to store file."));
  }
}
