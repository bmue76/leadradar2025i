// app/api/admin/v1/exports/[id]/download/route.ts
import fs from "node:fs";
import path from "node:path";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { getTraceId, jsonError } from "@/lib/api";

export const runtime = "nodejs";

type ParamsObj = { id?: string };
type RouteCtx = { params?: ParamsObj | Promise<ParamsObj> };

async function getIdFromCtx(ctx?: RouteCtx): Promise<string> {
  const p: any = ctx?.params;
  if (!p) return "";

  try {
    // Next.js can pass params as a Promise (sync-dynamic-apis)
    const resolved: ParamsObj = typeof p?.then === "function" ? await p : (p as ParamsObj);
    const id = resolved?.id ? String(resolved.id).trim() : "";
    return id;
  } catch {
    return "";
  }
}

async function exportIdFromCtxOrUrl(req: Request, ctx?: RouteCtx): Promise<string> {
  const fromCtx = await getIdFromCtx(ctx);
  if (fromCtx) return fromCtx;

  // Fallback: /api/admin/v1/exports/{id}/download
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

function safeFilename(s: string): string {
  return s
    .trim()
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export async function GET(req: Request, ctx: RouteCtx) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const id = await exportIdFromCtxOrUrl(req, ctx);
  if (!id) return jsonError(req, 400, "INVALID_PARAMS", "Missing export id.");

  const job = await prisma.exportJob.findFirst({
    where: { id, tenantId: scoped.ctx.tenantId, type: "CSV" },
    select: {
      id: true,
      status: true,
      resultStorageKey: true,
      form: { select: { name: true } },
      createdAt: true,
    },
  });

  if (!job) return jsonError(req, 404, "NOT_FOUND", "Export job not found.");
  if (job.status !== "DONE") {
    return jsonError(req, 409, "NOT_READY", `Export job status is ${job.status}.`);
  }

  const filePath = job.resultStorageKey?.trim() || "";
  if (!filePath) {
    return jsonError(req, 500, "MISSING_RESULT", "Export result not available.");
  }

  // MVP safety: only allow reads under .tmp_exports
  const root = path.join(process.cwd(), ".tmp_exports");
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(root))) {
    return jsonError(req, 403, "FORBIDDEN", "Invalid export storage path.");
  }

  if (!fs.existsSync(resolved)) {
    return jsonError(req, 404, "NOT_FOUND", "Export file not found on disk.");
  }

  // CSV is TEXT → simplest + TS-safe
  const csvText = fs.readFileSync(resolved, "utf8");

  const traceId = getTraceId(req);
  const h = new Headers();
  h.set("x-trace-id", traceId);
  h.set("content-type", "text/csv; charset=utf-8");

  const base = job.form?.name ? safeFilename(job.form.name) : "leadradar_export";
  const date = job.createdAt.toISOString().slice(0, 10);
  const filename = `${base}_${date}_${job.id}.csv`;
  h.set("content-disposition", `attachment; filename="${filename}"`);

  return new Response(csvText, { status: 200, headers: h });
}
