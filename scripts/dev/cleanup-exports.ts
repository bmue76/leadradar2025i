#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { runExportCleanup, type ExportCleanupSummary } from "../../lib/exports/cleanup";

type Args = {
  days: number;
  tenantId?: string;
  dryRun: boolean;
  help: boolean;
  unknown: string[];
};

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/dev/cleanup-exports.ts --days 14 [--tenant <id>] [--dry-run]",
    "",
    "Args:",
    "  --days <number>     Retention in days (default 14, range 1..365)",
    "  --tenant <id>       Optional tenant scope",
    "  --dry-run           Do not delete, only report",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const out: Args = { days: 14, dryRun: false, help: false, unknown: [] };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }

    if (a === "--dry-run" || a === "--dryRun") {
      out.dryRun = true;
      continue;
    }

    if (a === "--days") {
      const v = argv[i + 1];
      i++;
      out.days = Number(v);
      continue;
    }
    if (a.startsWith("--days=")) {
      out.days = Number(a.split("=", 2)[1]);
      continue;
    }

    if (a === "--tenant") {
      const v = argv[i + 1];
      i++;
      out.tenantId = v;
      continue;
    }
    if (a.startsWith("--tenant=")) {
      out.tenantId = a.split("=", 2)[1];
      continue;
    }

    out.unknown.push(a);
  }

  return out;
}

function makeEarlyErrorSummary(args: Args, errors: string[]): ExportCleanupSummary {
  const now = new Date();
  const cutoff = new Date(now.getTime() - (Number.isFinite(args.days) ? args.days : 14) * 24 * 60 * 60 * 1000);

  return {
    dryRun: args.dryRun,
    days: args.days,
    cutoffIso: cutoff.toISOString(),
    scope: { tenantId: args.tenantId },

    deleted: [],
    skipped: [],
    errors: errors.map((e) => ({ error: e })),
    dirsRemoved: 0,

    stats: {
      scannedJobs: 0,
      eligibleJobs: 0,
      filesMissing: 0,
      filesDeleted: 0,
      bytesFreed: 0,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const validationErrors: string[] = [];

  if (!Number.isFinite(args.days) || !Number.isInteger(args.days)) {
    validationErrors.push("Invalid --days: must be an integer.");
  } else if (args.days < 1 || args.days > 365) {
    validationErrors.push("Invalid --days: must be within 1..365.");
  }

  if (args.unknown.length > 0) {
    validationErrors.push(`Unknown args: ${args.unknown.join(" ")}`);
  }

  if (validationErrors.length > 0) {
    const summary = makeEarlyErrorSummary(args, validationErrors);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const summary = await runExportCleanup({
      prisma,
      days: args.days,
      dryRun: args.dryRun,
      tenantId: args.tenantId,
    });

    console.log(JSON.stringify(summary, null, 2));

    // Non-zero exit only if there are operational errors
    if (summary.errors.length > 0) process.exit(1);
  } catch (e: any) {
    const summary = makeEarlyErrorSummary(args, [e?.message ? String(e.message) : String(e)]);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
