// scripts/dev/cleanup-tmp-storage.ts
import path from "node:path";
import fsp from "node:fs/promises";
import { Dirent } from "node:fs";

const EXPORTS_ROOT = path.resolve(process.cwd(), ".tmp_exports");
const UPLOADS_ROOT = path.resolve(process.cwd(), ".tmp_uploads");
const ROOTS = [EXPORTS_ROOT, UPLOADS_ROOT] as const;

type Counters = {
  scanned: number;
  deleted: number;
  skipped: number;
  errors: number;
  dirsRemoved: number;
};

function parseDaysArg(argv: string[]): number {
  const idx = argv.indexOf("--days");
  if (idx === -1) return 14;
  const raw = argv[idx + 1];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 14;
  return Math.floor(n);
}

function isUnderRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (!rel) return true;
  const first = rel.split(path.sep)[0];
  if (first === "..") return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isEmptyDir(dir: string): Promise<boolean> {
  const entries = await readDirSafe(dir);
  return entries.length === 0;
}

async function walkAndCleanup(root: string, cutoffMs: number, counters: Counters): Promise<void> {
  const entries = await readDirSafe(root);

  for (const ent of entries) {
    const full = path.join(root, ent.name);

    // hard guard: never operate outside the allowed roots
    if (!ROOTS.some((r) => isUnderRoot(r, full))) {
      counters.skipped++;
      continue;
    }

    // skip symlinks
    if (ent.isSymbolicLink()) {
      counters.skipped++;
      continue;
    }

    if (ent.isDirectory()) {
      await walkAndCleanup(full, cutoffMs, counters);

      // attempt to remove empty directories (not root itself)
      if (full !== root && (await isEmptyDir(full))) {
        try {
          await fsp.rmdir(full);
          counters.dirsRemoved++;
        } catch {
          // ignore
        }
      }
      continue;
    }

    if (!ent.isFile()) {
      counters.skipped++;
      continue;
    }

    counters.scanned++;

    try {
      const st = await fsp.stat(full);
      const mtimeMs = st.mtimeMs;

      if (mtimeMs < cutoffMs) {
        await fsp.unlink(full);
        counters.deleted++;
      } else {
        counters.skipped++;
      }
    } catch {
      counters.errors++;
    }
  }
}

async function ensureRootsExist() {
  for (const r of ROOTS) {
    await fsp.mkdir(r, { recursive: true }).catch(() => undefined);
  }
}

async function main() {
  const days = parseDaysArg(process.argv.slice(2));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  await ensureRootsExist();

  const counters: Counters = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    dirsRemoved: 0,
  };

  for (const r of ROOTS) {
    await walkAndCleanup(r, cutoff, counters);
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        roots: ROOTS,
        days,
        cutoffIso: new Date(cutoff).toISOString(),
        ...counters,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("cleanup-tmp-storage failed:", err);
  process.exitCode = 1;
});
