import { z } from "zod";

import { jsonOk, jsonError } from "@/lib/api";
import { validateBody, isHttpError } from "@/lib/http";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";

import { runExportCleanup } from "@/lib/exports/cleanup";

export const runtime = "nodejs";

const BodySchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
  dryRun: z.boolean().optional(),
});

function tenantIdFromTenantResult(tr: any): string {
  return String(tr?.tenantId ?? tr?.ctx?.tenantId ?? "");
}

export async function POST(req: Request) {
  try {
    const tr: any = await requireTenantContext(req);
    const tenantId = tenantIdFromTenantResult(tr);
    if (!tenantId) return jsonError(req, 401, "UNAUTHORIZED", "Missing tenant context");

    const body = await validateBody(req, BodySchema);
    const days = body.days ?? 14;
    const dryRun = body.dryRun ?? false;

    const summary = await runExportCleanup({
      prisma,
      tenantId,
      days,
      dryRun,
    });

    return jsonOk(req, { summary });
  } catch (e: any) {
    if (isHttpError(e)) return jsonError(req, e.status, e.code, e.message);
    return jsonError(req, 500, "INTERNAL", "Internal server error");
  }
}
