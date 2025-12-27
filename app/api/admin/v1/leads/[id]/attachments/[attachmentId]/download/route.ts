// app/api/admin/v1/leads/[id]/attachments/[attachmentId]/download/route.ts
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";

import { jsonError } from "@/lib/api";
import { HttpError } from "@/lib/http";
import { requireTenantContext } from "@/lib/auth";
import prisma from "@/lib/prisma";

import {
  UPLOADS_ROOT_ABS,
  isSafeRelativeKey,
  resolveUnderRoot,
  sanitizeFilename,
  createReadStreamSafe,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDispositionAttachment(filename: string) {
  const safe = sanitizeFilename(filename || "attachment");
  return `attachment; filename="${safe}"`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const traceId = req.headers.get("x-trace-id") ?? crypto.randomUUID();

  try {
    const t = await requireTenantContext(req);
    if (!t.ok) return t.res;

    const { id: leadId, attachmentId } = await ctx.params;
    const tenantId = t.ctx.tenantId;

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId } as any,
      select: { id: true },
    });
    if (!lead) return jsonError(req, 404, "NOT_FOUND", "Not found");

    const attachment = await prisma.leadAttachment.findFirst({
      where: { id: attachmentId, tenantId, leadId } as any,
      select: {
        id: true,
        storageKey: true,
        filename: true,
        mimeType: true,
      } as any,
    });

    if (!attachment) return jsonError(req, 404, "NOT_FOUND", "Not found");

    const storageKey: string | null = (attachment as any).storageKey ?? null;
    if (!storageKey) return jsonError(req, 404, "NO_FILE", "No file");

    if (!isSafeRelativeKey(storageKey)) {
      return jsonError(req, 400, "INVALID_STORAGE_KEY", "Invalid storage key");
    }

    const absPath = resolveUnderRoot(UPLOADS_ROOT_ABS, storageKey);

    const stat = await fsp.stat(absPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return jsonError(req, 404, "NO_FILE", "No file");
    }

    const filename = (attachment as any).filename ?? "attachment";
    const mimeType = (attachment as any).mimeType ?? "application/octet-stream";

    const nodeStream = createReadStreamSafe(absPath);
    const webStream = Readable.toWeb(nodeStream as any) as any;

    return new Response(webStream, {
      status: 200,
      headers: {
        "content-type": mimeType,
        "content-length": String(stat.size),
        "content-disposition": contentDispositionAttachment(filename),
        "cache-control": "no-store",
        "x-trace-id": traceId,
      },
    });
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
