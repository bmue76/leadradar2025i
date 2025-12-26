// app/api/admin/v1/exports/[id]/download/route.ts
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { getTraceId, jsonError } from "@/lib/api";

export const runtime = "nodejs";

type RouteParams = { id: string };
type RouteCtx = { params: Promise<RouteParams> };

function normalizeStorageKey(key: string): string {
  // Ensure posix-ish, no leading slash
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

function exportIdFromUrl(req: Request): string {
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("exports");
    if (idx >= 0 && parts[idx + 1]) return String(parts[idx + 1]).trim();
  } catch {
    // ignore
  }
  return "";
}

export async function GET(req: Request, ctx: RouteCtx) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const fromCtx = (await ctx.params)?.id ? String((await ctx.params).id).trim() : "";
  const id = fromCtx || exportIdFromUrl(req);
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing export id.");

  const job = await prisma.exportJob.findFirst({
    where: { id, tenantId: scoped.ctx.tenantId, type: "CSV" },
    select: {
      id: true,
      status: true,
      resultStorageKey: true,
    },
  });

  if (!job) return jsonError(req, 404, "NOT_FOUND", "Export job not found.");
  if (job.status !== "DONE") {
    return jsonError(req, 409, "NOT_READY", `Export job status is ${job.status}.`);
  }

  const keyRaw = job.resultStorageKey?.trim() || "";
  if (!keyRaw) {
    return jsonError(req, 500, "MISSING_RESULT", "Export result not available.");
  }

  // Must be relative and under .tmp_exports/
  if (path.isAbsolute(keyRaw)) {
    return jsonError(req, 403, "FORBIDDEN", "Invalid export storage path.");
  }

  const key = normalizeStorageKey(keyRaw);
  if (!key.startsWith(".tmp_exports/")) {
    return jsonError(req, 403, "FORBIDDEN", "Invalid export storage path.");
  }

  const root = path.resolve(process.cwd(), ".tmp_exports");
  const resolved = path.resolve(process.cwd(), key);

  // Prevent traversal / scope escape
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootPrefix)) {
    return jsonError(req, 403, "FORBIDDEN", "Invalid export storage path.");
  }

  if (!fs.existsSync(resolved)) {
    return jsonError(req, 404, "NOT_FOUND", "Export file not found on disk.");
  }

  const traceId = getTraceId(req);
  const h = new Headers();
  h.set("x-trace-id", traceId);
  h.set("content-type", "text/csv; charset=utf-8");
  h.set("content-disposition", `attachment; filename="leadradar_export_${job.id}.csv"`);

  // Stream file (no Buffer/large string)
  const nodeStream = fs.createReadStream(resolved);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, { status: 200, headers: h });
}
