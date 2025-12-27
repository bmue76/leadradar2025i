import * as fsp from "node:fs/promises";
import { NextRequest } from "next/server";

import { getTraceId, jsonError } from "@/lib/api";
import { HttpError, isHttpError } from "@/lib/http";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";

import { resolveExportFileAbsPath } from "@/lib/exports/cleanup";

export const runtime = "nodejs";

function tenantIdFromTenantResult(tr: any): string {
  return String(tr?.tenantId ?? tr?.ctx?.tenantId ?? "");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = getTraceId(req);

  try {
    const { id } = await params;
    if (!id) throw new HttpError(400, "BAD_REQUEST", "Missing export id");

    const tr: any = await requireTenantContext(req);
    const tenantId = tenantIdFromTenantResult(tr);
    if (!tenantId) throw new HttpError(401, "UNAUTHORIZED", "Missing tenant context");

    const job = await prisma.exportJob.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, resultStorageKey: true },
    });

    if (!job) throw new HttpError(404, "NOT_FOUND", "Export job not found");

    if (job.status !== "DONE") {
      throw new HttpError(409, "NOT_READY", "Export is not ready for download");
    }

    const key = job.resultStorageKey ? String(job.resultStorageKey) : "";
    if (!key) {
      return jsonError(req, 404, "NO_FILE", "File not found (cleaned up)");
    }

    const resolved = resolveExportFileAbsPath(key);
    if (!resolved) {
      // Root-Guard block => treat as missing (no leak)
      return jsonError(req, 404, "NO_FILE", "File not found (cleaned up)");
    }

    // exists?
    try {
      const st = await fsp.stat(resolved.absPath);
      if (!st.isFile()) return jsonError(req, 404, "NO_FILE", "File not found (cleaned up)");
    } catch (e: any) {
      if (e?.code === "ENOENT") return jsonError(req, 404, "NO_FILE", "File not found (cleaned up)");
      throw e;
    }

    const csvBuf = await fsp.readFile(resolved.absPath);
    const body = new Uint8Array(csvBuf);

    const filename = `leadradar-export-${job.id}.csv`;
    const headers = new Headers();
    headers.set("content-type", "text/csv; charset=utf-8");
    headers.set("content-disposition", `attachment; filename="${filename}"`);
    headers.set("cache-control", "no-store");
    headers.set("x-trace-id", traceId);

    return new Response(body, { status: 200, headers });
  } catch (e: any) {
    if (isHttpError(e)) return jsonError(req, e.status, e.code, e.message);
    return jsonError(req, 500, "INTERNAL", "Internal server error");
  }
}
