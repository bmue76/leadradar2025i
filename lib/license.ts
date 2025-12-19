// lib/license.ts
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // Crockford-ish, no I/L/O/0/1

export function normalizeLicenseKey(input: string): string {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

export function generateLicenseKey(opts?: {
  prefix?: string; // default "LR"
  groups?: number; // default 4
  groupLength?: number; // default 4
}): string {
  const prefix = (opts?.prefix ?? "LR").toUpperCase();
  const groups = opts?.groups ?? 4;
  const groupLength = opts?.groupLength ?? 4;

  const totalChars = groups * groupLength;
  const bytes = new Uint8Array(totalChars);
  // Works in Node runtime (Next Route Handlers) via WebCrypto
  crypto.getRandomValues(bytes);

  let idx = 0;
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    for (let i = 0; i < groupLength; i++) {
      const b = bytes[idx++];
      // 256 % 32 == 0 => no modulo bias
      part += ALPHABET[b % ALPHABET.length];
    }
    parts.push(part);
  }

  return `${prefix}-${parts.join("-")}`;
}
