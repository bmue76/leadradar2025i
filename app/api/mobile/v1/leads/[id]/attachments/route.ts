// app/api/mobile/v1/leads/[id]/attachments/route.ts
import crypto from "node:crypto";
import { NextRequest } from "next/server";

import { jsonOk, jsonError } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requireTenantContext } from "@/lib/auth";
import prisma from "@/lib/prisma";

import {
  UPLOADS_ROOT_ABS,
  buildUploadsKey,
  resolveUnderRoot,
  writeFileAtomic,
  sanitizeFilename,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const t = await requireTenantContext(req);
    if (!t.ok) return t.res;

    const { id: leadId } = await ctx.params;
    const tenantId = t.ctx.tenantId;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId } as any,
      select: { id: true },
    });
    if (!lead) return jsonError(req, 404, "NOT_FOUND", "Lead not found");

    const formData = (await req.formData()) as any;
    const file = formData?.get ? formData.get("file") : null;

    if (!file || typeof file.arrayBuffer !== "function") {
      return jsonError(req, 400, "INVALID_BODY", "Missing multipart file field 'file'");
    }

    const bytes = new Uint8Array(Buffer.from(await file.arrayBuffer()));
    const mimeType = (file.type as string) || "application/octet-stream";
    const filename = sanitizeFilename((file.name as string) || "attachment.bin") || "attachment.bin";

    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    const storageKey = buildUploadsKey({
      tenantId,
      parts: ["leads", leadId, "attachments"],
      filename: `${unique}-${filename}`,
    });

    const absPath = resolveUnderRoot(UPLOADS_ROOT_ABS, storageKey);
    await writeFileAtomic(absPath, bytes);

    const attachment = await prisma.leadAttachment.create({
      data: {
        tenantId,
        leadId,
        filename,
        mimeType,
        storageKey,
      } as any,
      select: { id: true },
    });

    return jsonOk(req, { id: attachment.id });
  } catch (err: any) {
    if (err instanceof HttpError) {
      return jsonError(req, err.status, err.code, err.message);
    }
    if (err?.code === "INVALID_STORAGE_KEY") {
      return jsonError(req, 400, "INVALID_STORAGE_KEY", "Invalid storage key");
    }
    return jsonError(req, 500, "INTERNAL_ERROR", "Unexpected error");
  }
}
