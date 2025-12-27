// lib/storage.ts
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";

export const EXPORTS_ROOT_KEY = ".tmp_exports";
export const UPLOADS_ROOT_KEY = ".tmp_uploads";

export const EXPORTS_ROOT_ABS = path.resolve(process.cwd(), EXPORTS_ROOT_KEY);
export const UPLOADS_ROOT_ABS = path.resolve(process.cwd(), UPLOADS_ROOT_KEY);

export const STORAGE_ALLOWED_ROOTS = [EXPORTS_ROOT_ABS, UPLOADS_ROOT_ABS] as const;
export type StorageAllowedRootAbs = (typeof STORAGE_ALLOWED_ROOTS)[number];

export class StorageKeyError extends Error {
  public readonly code: "INVALID_STORAGE_KEY";
  constructor(message = "Invalid storage key") {
    super(message);
    this.code = "INVALID_STORAGE_KEY";
  }
}

export function toPosixKey(key: string): string {
  return key.replace(/\\/g, "/");
}

function hasNullByte(s: string) {
  return s.includes("\0");
}

function isWindowsDrivePath(posixKey: string) {
  return /^[a-zA-Z]:\//.test(posixKey);
}

/**
 * Storage keys MUST be repo-relative and start with:
 *  - ".tmp_exports/..."
 *  - ".tmp_uploads/..."
 * Blocks traversal and absolute paths (Windows + Linux).
 */
export function isSafeRelativeKey(key: string): boolean {
  if (typeof key !== "string") return false;
  const raw = key.trim();
  if (!raw) return false;
  if (raw.length > 4096) return false;
  if (hasNullByte(raw)) return false;

  const k = toPosixKey(raw);

  // absolute paths / UNC / drive
  if (k.startsWith("/") || k.startsWith("\\") || k.startsWith("//")) return false;
  if (isWindowsDrivePath(k)) return false;

  // conservative: block ":" (windows ADS etc.)
  if (k.includes(":")) return false;

  const parts = k.split("/");
  if (parts.length === 0) return false;

  for (const p of parts) {
    if (!p) return false; // no empty segments
    if (p === "." || p === "..") return false;
  }

  if (
    !(
      k === EXPORTS_ROOT_KEY ||
      k.startsWith(`${EXPORTS_ROOT_KEY}/`) ||
      k === UPLOADS_ROOT_KEY ||
      k.startsWith(`${UPLOADS_ROOT_KEY}/`)
    )
  ) {
    return false;
  }

  return true;
}

export function assertSafeRelativeKey(key: string): void {
  if (!isSafeRelativeKey(key)) {
    throw new StorageKeyError("Storage key is not a safe relative key");
  }
}

export async function ensureDir(absDirPath: string): Promise<void> {
  await fsp.mkdir(absDirPath, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  const fallback = "file";
  if (typeof name !== "string") return fallback;

  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return fallback;

  const normalized = cleaned.replace(/^[. ]+/, "").replace(/[. ]+$/, "");
  const finalName = normalized || fallback;

  return finalName.length > 180 ? finalName.slice(0, 180) : finalName;
}

function sanitizePathSegment(seg: string): string {
  const s = (seg ?? "").toString().trim();
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, "_");
  const noDots = cleaned.replace(/^\.+/, "");
  return noDots || "x";
}

export function buildUploadsKey(params: {
  tenantId: string;
  parts?: string[];
  filename: string;
}): string {
  const tenant = sanitizePathSegment(params.tenantId);
  const extra = (params.parts ?? []).map(sanitizePathSegment);
  const file = sanitizeFilename(params.filename);
  return [UPLOADS_ROOT_KEY, tenant, ...extra, file].join("/");
}

export function buildExportsKey(params: {
  tenantId: string;
  parts?: string[];
  filename: string;
}): string {
  const tenant = sanitizePathSegment(params.tenantId);
  const extra = (params.parts ?? []).map(sanitizePathSegment);
  const file = sanitizeFilename(params.filename);
  return [EXPORTS_ROOT_KEY, tenant, ...extra, file].join("/");
}

export function isUnderRoot(rootAbs: string, targetAbs: string): boolean {
  const rel = path.relative(rootAbs, targetAbs);
  if (!rel) return true;
  const first = rel.split(path.sep)[0];
  if (first === "..") return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Resolve a safe repo-relative key to an absolute path and enforce that it stays under the given root.
 */
export function resolveUnderRoot(rootAbs: string, key: string): string {
  assertSafeRelativeKey(key);

  const keyPosix = toPosixKey(key);
  const abs = path.resolve(process.cwd(), ...keyPosix.split("/"));

  if (!isUnderRoot(rootAbs, abs)) {
    throw new StorageKeyError("Resolved path escapes storage root");
  }
  return abs;
}

export function resolveUnderAllowedRoot(key: string): { rootAbs: StorageAllowedRootAbs; absPath: string } {
  assertSafeRelativeKey(key);
  const keyPosix = toPosixKey(key);
  const abs = path.resolve(process.cwd(), ...keyPosix.split("/"));

  for (const root of STORAGE_ALLOWED_ROOTS) {
    if (isUnderRoot(root, abs)) return { rootAbs: root, absPath: abs };
  }
  throw new StorageKeyError("Key is not under an allowed storage root");
}

/**
 * Best-effort atomic file write: write to temp file in same dir, then rename.
 * Uses Uint8Array to avoid Buffer typing issues in some TS setups.
 */
export async function writeFileAtomic(
  absPath: string,
  data: Uint8Array | string,
  opts?: { mode?: number }
): Promise<void> {
  const dir = path.dirname(absPath);
  await ensureDir(dir);

  const tmp = `${absPath}.${crypto.randomUUID()}.tmp`;

  const payload: Uint8Array | string =
    typeof data === "string" ? data : new Uint8Array(data);

  await fsp.writeFile(tmp, payload as any, { mode: opts?.mode });

  try {
    await fsp.rename(tmp, absPath);
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      await fsp.unlink(absPath).catch(() => undefined);
      await fsp.rename(tmp, absPath);
      return;
    }
    await fsp.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function ensureStorageRoots(): Promise<void> {
  await ensureDir(EXPORTS_ROOT_ABS);
  await ensureDir(UPLOADS_ROOT_ABS);
}

export function createReadStreamSafe(absPath: string): fs.ReadStream {
  return fs.createReadStream(absPath);
}

/**
 * Best-effort migration helper: if DB contains an absolute path, try to extract a valid
 * relative key starting at ".tmp_exports/" or ".tmp_uploads/".
 */
export function coerceLegacyPathToRelativeKey(input: string): string | null {
  if (typeof input !== "string") return null;
  const s = toPosixKey(input.trim());
  const idxExports = s.indexOf(`${EXPORTS_ROOT_KEY}/`);
  const idxUploads = s.indexOf(`${UPLOADS_ROOT_KEY}/`);
  const idx =
    idxExports >= 0 && idxUploads >= 0 ? Math.min(idxExports, idxUploads) : Math.max(idxExports, idxUploads);
  if (idx < 0) return null;
  const candidate = s.slice(idx);
  return isSafeRelativeKey(candidate) ? candidate : null;
}
