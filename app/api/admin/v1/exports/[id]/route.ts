import { NextRequest } from "next/server";

import { jsonOk, jsonError } from "@/lib/api";
import { HttpError, isHttpError } from "@/lib/http";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";

export const runtime = "nodejs";

function tenantIdFromTenantResult(tr: any): string {
  return String(tr?.tenantId ?? tr?.ctx?.tenantId ?? "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) throw new HttpError(400, "BAD_REQUEST", "Missing export id");

    const tr: any = await requireTenantContext(req);
    const tenantId = tenantIdFromTenantResult(tr);
    if (!tenantId) throw new HttpError(401, "UNAUTHORIZED", "Missing tenant context");

    const job: any = await prisma.exportJob.findFirst({
      where: { id, tenantId },
    });

    if (!job) throw new HttpError(404, "NOT_FOUND", "Export job not found");

    const downloadUrl =
      job.status === "DONE"
        ? `/api/admin/v1/exports/${job.id}/download`
        : undefined;

    // keep response stable-ish: return core fields + downloadUrl only if DONE
    return jsonOk(req, {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      // keep for audit / debugging (file may be missing after retention)
      resultStorageKey: job.resultStorageKey ?? null,
      downloadUrl,
      // optional: if your model has a JSON "file" config, expose it (safe)
      file: job.file ?? undefined,
    });
  } catch (e: any) {
    if (isHttpError(e)) return jsonError(req, e.status, e.code, e.message);
    return jsonError(req, 500, "INTERNAL", "Internal server error");
  }
}
