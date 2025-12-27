import path from "node:path";
import { createReadStream } from "node:fs";
import * as fsp from "node:fs/promises";

import type { PrismaClient } from "@prisma/client";

export type ExportCleanupSkippedReason =
  | "NOT_ELIGIBLE_STATUS"
  | "TOO_RECENT"
  | "NO_RESULT_KEY"
  | "FILE_ALREADY_MISSING"
  | "ROOT_GUARD_BLOCKED";

export type ExportCleanupSummary = {
  dryRun: boolean;
  days: number;
  cutoffIso: string;
  scope: { tenantId?: string };

  deleted: Array<{
    jobId: string;
    resultStorageKey: string;
    bytes?: number;
  }>;

  skipped: Array<{
    jobId: string;
    reason: ExportCleanupSkippedReason;
  }>;

  errors: Array<{
    jobId?: string;
    resultStorageKey?: string;
    error: string;
  }>;

  dirsRemoved: number;

  stats: {
    scannedJobs: number;
    eligibleJobs: number;
    filesMissing: number;
    filesDeleted: number;
    bytesFreed: number;
  };
};

type CleanupOpts = {
  prisma: PrismaClient;
  days: number;
  dryRun: boolean;
  tenantId?: string;
};

const EXPORTS_ROOT_DIRNAME = ".tmp_exports";

function exportsRootAbs(): string {
  return path.resolve(process.cwd(), EXPORTS_ROOT_DIRNAME);
}

function stripExportsRootPrefix(rawKey: string): string {
  const k = rawKey.replaceAll("\\", "/");
  if (k.startsWith(`${EXPORTS_ROOT_DIRNAME}/`)) return k.slice(`${EXPORTS_ROOT_DIRNAME}/`.length);
  if (k.startsWith(`./${EXPORTS_ROOT_DIRNAME}/`)) return k.slice(`./${EXPORTS_ROOT_DIRNAME}/`.length);
  return rawKey;
}

/**
 * Sanitize DB key to a relative path segment:
 * - normalize slashes
 * - strip ".tmp_exports/" prefix if present
 * - remove leading "/" to prevent absolute paths
 */
function sanitizeStorageKey(rawKey: string): string {
  const stripped = stripExportsRootPrefix(rawKey);
  const normalized = stripped.replaceAll("\\", "/").replace(/^\/+/, "");
  // Important: keep relative. path.resolve(root, key) will handle ".." but we also root-guard.
  return normalized;
}

function isUnderRoot(rootAbs: string, candidateAbs: string): boolean {
  const root = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return candidateAbs.startsWith(root);
}

async function fileStatSafe(absPath: string): Promise<null | { size: number }> {
  try {
    const st = await fsp.stat(absPath);
    if (!st.isFile()) return null;
    return { size: st.size };
  } catch (e: any) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

async function removeEmptyParents(startDirAbs: string, stopRootAbs: string): Promise<number> {
  let removed = 0;
  let current = startDirAbs;

  const stopRoot = stopRootAbs.endsWith(path.sep) ? stopRootAbs.slice(0, -1) : stopRootAbs;

  while (current && current !== stopRoot) {
    // Root guard: never go above stopRoot
    if (!isUnderRoot(stopRootAbs, current + path.sep)) break;

    try {
      const entries = await fsp.readdir(current);
      if (entries.length > 0) break;

      await fsp.rmdir(current);
      removed += 1;

      current = path.dirname(current);
    } catch (e: any) {
      // If dir doesn't exist / not empty / permission etc. => stop
      break;
    }
  }

  return removed;
}

export async function runExportCleanup(opts: CleanupOpts): Promise<ExportCleanupSummary> {
  const days = Number(opts.days);
  const dryRun = Boolean(opts.dryRun);

  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const summary: ExportCleanupSummary = {
    dryRun,
    days,
    cutoffIso: cutoff.toISOString(),
    scope: { tenantId: opts.tenantId },

    deleted: [],
    skipped: [],
    errors: [],
    dirsRemoved: 0,

    stats: {
      scannedJobs: 0,
      eligibleJobs: 0,
      filesMissing: 0,
      filesDeleted: 0,
      bytesFreed: 0,
    },
  };

  const where: any = {
    status: { in: ["DONE", "FAILED"] },
    updatedAt: { lte: cutoff },
  };
  if (opts.tenantId) where.tenantId = opts.tenantId;

  const jobs = await opts.prisma.exportJob.findMany({
    where,
    select: {
      id: true,
      tenantId: true,
      status: true,
      updatedAt: true,
      resultStorageKey: true,
    },
    orderBy: { updatedAt: "asc" },
  });

  summary.stats.scannedJobs = jobs.length;

  const rootAbs = exportsRootAbs();

  for (const job of jobs) {
    summary.stats.eligibleJobs += 1;

    const key = job.resultStorageKey ? String(job.resultStorageKey) : "";
    if (!key) {
      summary.skipped.push({ jobId: job.id, reason: "NO_RESULT_KEY" });
      continue;
    }

    const safeKey = sanitizeStorageKey(key);
    const absPath = path.resolve(rootAbs, safeKey);

    if (!isUnderRoot(rootAbs, absPath)) {
      summary.skipped.push({ jobId: job.id, reason: "ROOT_GUARD_BLOCKED" });
      continue;
    }

    try {
      const st = await fileStatSafe(absPath);
      if (!st) {
        summary.skipped.push({ jobId: job.id, reason: "FILE_ALREADY_MISSING" });
        summary.stats.filesMissing += 1;
        continue;
      }

      summary.deleted.push({
        jobId: job.id,
        resultStorageKey: safeKey,
        bytes: st.size,
      });

      summary.stats.bytesFreed += st.size;

      if (!dryRun) {
        await fsp.unlink(absPath);
        summary.stats.filesDeleted += 1;

        // Remove empty parent directories up to root
        const parentDir = path.dirname(absPath);
        summary.dirsRemoved += await removeEmptyParents(parentDir, rootAbs);
      }
    } catch (e: any) {
      summary.errors.push({
        jobId: job.id,
        resultStorageKey: safeKey,
        error: e?.message ? String(e.message) : String(e),
      });
    }
  }

  // In dry-run, we still present "would delete" under deleted[].
  if (dryRun) {
    summary.stats.filesDeleted = summary.deleted.length;
  }

  return summary;
}

/**
 * Utility for download endpoint: resolve a storage key to a safe absolute file path under .tmp_exports.
 * Returns null if root-guard fails.
 */
export function resolveExportFileAbsPath(resultStorageKey: string): { rootAbs: string; absPath: string; safeKey: string } | null {
  const rootAbs = exportsRootAbs();
  const safeKey = sanitizeStorageKey(resultStorageKey);
  const absPath = path.resolve(rootAbs, safeKey);
  if (!isUnderRoot(rootAbs, absPath)) return null;
  return { rootAbs, absPath, safeKey };
}

/**
 * Utility for download endpoint: create a Node read stream for a resolved export file.
 * (Convenience wrapper, optional)
 */
export function createExportReadStream(absPath: string) {
  return createReadStream(absPath);
}
