// app/api/mobile/v1/leads/route.ts
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonOk, jsonError } from "@/lib/api";
import { validateBody, HttpError } from "@/lib/http";
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

const BodySchema = z
  .object({
    formId: z.string().min(1),

    // flexible payload
    data: z.any().optional(),
    values: z.any().optional(),
    fields: z.any().optional(),
    payload: z.any().optional(),

    // base64 card (legacy + nested)
    cardBase64: z.string().optional(),
    cardFilename: z.string().optional(),
    cardMimeType: z.string().optional(),
    card: z
      .object({
        base64: z.string().optional(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

function decodeBase64(input: string): Uint8Array {
  const s = (input ?? "").trim();
  if (!s) return new Uint8Array();

  const m = s.match(/^data:([^;]+);base64,(.*)$/);
  const base64 = m ? m[2] : s;

  const buf = Buffer.from(base64, "base64");
  return new Uint8Array(buf);
}

function inferExt(mimeType?: string) {
  const mt = (mimeType ?? "").toLowerCase();
  if (mt.includes("jpeg")) return "jpg";
  if (mt.includes("png")) return "png";
  if (mt.includes("webp")) return "webp";
  if (mt.includes("pdf")) return "pdf";
  return "bin";
}

export async function POST(req: NextRequest) {
  try {
    const t = await requireTenantContext(req);
    if (!t.ok) return t.res;

    const tenantId = t.ctx.tenantId;

    const body = await validateBody(req, BodySchema);

    const lead = await prisma.lead.create({
      data: {
        tenantId,
        formId: body.formId,
        data: (body.data ?? body.values ?? body.fields ?? body.payload ?? body) as any,
      } as any,
      select: { id: true },
    });

    const cardBase64 = body.cardBase64 ?? body.card?.base64;
    const cardMimeType = body.cardMimeType ?? body.card?.mimeType ?? "image/jpeg";
    const originalName = body.cardFilename ?? body.card?.filename;

    if (cardBase64) {
      const bytes = decodeBase64(cardBase64);
      if (bytes.byteLength > 0) {
        const ext = inferExt(cardMimeType);
        const safeName = sanitizeFilename(originalName ?? `card.${ext}`);
        const filename = safeName.includes(".") ? safeName : `${safeName}.${ext}`;

        const unique = `${Date.now()}-${crypto.randomUUID()}`;
        const storageKey = buildUploadsKey({
          tenantId,
          parts: ["leads", lead.id, "card"],
          filename: `${unique}-${filename}`,
        });

        const absPath = resolveUnderRoot(UPLOADS_ROOT_ABS, storageKey);
        await writeFileAtomic(absPath, bytes);

        await prisma.leadAttachment.create({
          data: {
            tenantId,
            leadId: lead.id,
            filename,
            mimeType: cardMimeType,
            storageKey,
          } as any,
          select: { id: true },
        });
      }
    }

    return jsonOk(req, { id: lead.id });
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
