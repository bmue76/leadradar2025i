// app/api/mobile/v1/leads/route.ts
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonOk, jsonError } from "@/lib/api";
import { validateBody, HttpError } from "@/lib/http";
import { requireMobileTenantContext } from "@/lib/auth";
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

    clientLeadId: z.string().min(1).optional(),
    capturedByDeviceUid: z.string().optional(),
    meta: z.any().optional(),

    // flexible payload
    data: z.any().optional(),
    values: z.any().optional(),
    fields: z.any().optional(),
    payload: z.any().optional(),

    // legacy card naming
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

    // mobile naming
    cardImageBase64: z.string().optional(),
    cardImageFilename: z.string().optional(),
    cardImageMimeType: z.string().optional(),
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
    const t = await requireMobileTenantContext(req);
    if (!t.ok) return t.res;

    const tenantId = t.ctx.tenantId;

    const body = await validateBody(req, BodySchema);

    // scope guard: form must belong to tenant
    const form = await prisma.form.findFirst({
      where: { id: body.formId, tenantId },
      select: { id: true },
    });
    if (!form) {
      return jsonError(req, 404, "NOT_FOUND", "Form not found for tenant.");
    }

    const dataJson = (body.data ?? body.values ?? body.fields ?? body.payload ?? body) as any;

    let leadId: string;

    // robust create: try extended schema, fallback to minimal
    try {
      const lead = await prisma.lead.create({
        data: {
          tenantId,
          formId: body.formId,
          clientLeadId: body.clientLeadId,
          capturedByDeviceUid: body.capturedByDeviceUid,
          data: dataJson,
          meta: body.meta,
        } as any,
        select: { id: true },
      });
      leadId = lead.id;
    } catch {
      const lead = await prisma.lead.create({
        data: {
          tenantId,
          formId: body.formId,
          data: dataJson,
        } as any,
        select: { id: true },
      });
      leadId = lead.id;
    }

    // accept both naming schemes
    const cardBase64 = body.cardImageBase64 ?? body.cardBase64 ?? body.card?.base64;
    const cardMimeType =
      body.cardImageMimeType ?? body.cardMimeType ?? body.card?.mimeType ?? "image/jpeg";
    const originalName =
      body.cardImageFilename ?? body.cardFilename ?? body.card?.filename;

    // attachment best-effort
    if (cardBase64) {
      try {
        const bytes = decodeBase64(cardBase64);
        if (bytes.byteLength > 0) {
          const ext = inferExt(cardMimeType);
          const safeName = sanitizeFilename(originalName ?? `card.${ext}`);
          const filename = safeName.includes(".") ? safeName : `${safeName}.${ext}`;

          const unique = `${Date.now()}-${crypto.randomUUID()}`;
          const storageKey = buildUploadsKey({
            tenantId,
            parts: ["leads", leadId, "card"],
            filename: `${unique}-${filename}`,
          });

          const absPath = resolveUnderRoot(UPLOADS_ROOT_ABS, storageKey);
          await writeFileAtomic(absPath, bytes);

          await prisma.leadAttachment.create({
            data: {
              tenantId,
              leadId,
              filename,
              mimeType: cardMimeType,
              storageKey,
            } as any,
            select: { id: true },
          });
        }
      } catch {
        // ignore attachment errors
      }
    }

    return jsonOk(req, { id: leadId });
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
