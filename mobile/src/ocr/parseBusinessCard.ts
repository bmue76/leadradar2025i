// mobile/src/ocr/parseBusinessCard.ts
import type { BusinessCardCandidates, BusinessCardCore, BusinessCardExtracted, BusinessCardField } from "./types";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b((https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,})(\/[^\s]*)?\b/gi;
const PHONE_LINE_RE = /[+()0-9][+()0-9\s\-\/.]{6,}[0-9]/g;

const COMPANY_SUFFIX_RE =
  /\b(ag|gmbh|sarl|sàrl|sa|ltd|inc|llc|kg|ohg|bv|nv|oy|ab|aps|plc|pty|co\.|company|corp\.|corporation)\b/i;

function normSpaces(s: string) {
  return String(s || "").replace(/\u00A0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function splitLines(rawText: string, lines?: string[]): string[] {
  if (Array.isArray(lines) && lines.length) return lines.map(normSpaces).filter(Boolean);
  return String(rawText || "")
    .split(/\r?\n/g)
    .map(normSpaces)
    .filter(Boolean);
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function extractEmails(text: string): string[] {
  const m = text.match(EMAIL_RE) ?? [];
  return uniq(m.map((x) => x.trim())).filter(Boolean);
}

function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s.replace(/^www\./i, "www.")}`;
}

function extractUrls(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(URL_RE);
  while ((m = re.exec(text)) !== null) {
    const full = m[0] || "";
    const clean = full.replace(/[),.;:]+$/g, "");
    if (!clean) continue;
    if (/@/.test(clean)) continue;
    out.push(normalizeUrl(clean));
  }
  return uniq(out);
}

function digitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(s: string): string {
  const raw = normSpaces(s).replace(/[.]/g, " ");
  return raw.replace(/[^0-9+]/g, " ").replace(/[ \t]+/g, " ").trim();
}

function extractPhones(lines: string[]): string[] {
  const candidates: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("fax")) continue;

    const matches = line.match(PHONE_LINE_RE) ?? [];
    for (const m of matches) {
      const normalized = normalizePhone(m);
      const d = digitsOnly(normalized);
      if (d.length < 7) continue;
      candidates.push(normalized);
    }
  }

  const uniqPhones = uniq(candidates);
  uniqPhones.sort((a, b) => {
    const aPlus = a.includes("+") ? 1 : 0;
    const bPlus = b.includes("+") ? 1 : 0;
    if (aPlus !== bPlus) return bPlus - aPlus;
    return digitsOnly(b).length - digitsOnly(a).length;
  });

  return uniqPhones;
}

function looksLikeName(line: string): boolean {
  const s = normSpaces(line);
  if (!s) return false;
  if (/@/.test(s)) return false;
  if (URL_RE.test(s)) return false;
  if (/\d/.test(s)) return false;
  if (COMPANY_SUFFIX_RE.test(s)) return false;

  const words = s.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;

  let cap = 0;
  for (const w of words) {
    if (/^[A-ZÄÖÜ][a-zäöüß'-]+$/.test(w)) cap += 1;
  }
  return cap >= 2;
}

function looksLikeCompany(line: string): boolean {
  const s = normSpaces(line);
  if (!s) return false;
  if (/@/.test(s)) return false;
  if (URL_RE.test(s)) return false;

  if (COMPANY_SUFFIX_RE.test(s)) return true;
  const letters = s.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length >= 6 && s === s.toUpperCase()) return true;

  return false;
}

function scoreConfidence(field: BusinessCardField, count: number): number {
  if (field === "email") return count === 1 ? 0.95 : count > 1 ? 0.85 : 0;
  if (field === "url") return count === 1 ? 0.9 : count > 1 ? 0.8 : 0;
  if (field === "phone") return count === 1 ? 0.85 : count > 1 ? 0.75 : 0;
  if (field === "name") return count === 1 ? 0.65 : count > 1 ? 0.55 : 0;
  if (field === "company") return count === 1 ? 0.65 : count > 1 ? 0.55 : 0;
  return 0;
}

function core(ex: BusinessCardCore): BusinessCardCore {
  return {
    email: ex.email,
    phone: ex.phone,
    url: ex.url,
    name: ex.name,
    company: ex.company,
    confidence: ex.confidence,
    notes: ex.notes,
    candidates: ex.candidates,
  };
}

export function parseBusinessCard(input: string | { rawText: string; lines?: string[] }): BusinessCardExtracted {
  const rawText = typeof input === "string" ? input : input.rawText;
  const lines = splitLines(rawText, typeof input === "string" ? undefined : input.lines);

  const notes: string[] = [];

  const emails = extractEmails(rawText);
  const urls = extractUrls(rawText);
  const phones = extractPhones(lines);

  const companies = uniq(lines.filter((l) => looksLikeCompany(l) && !/@/.test(l) && !/\d/.test(l)).slice(0, 4));
  const names = uniq(lines.filter(looksLikeName).slice(0, 4));

  const base: BusinessCardCore = {
    candidates: {
      emails,
      phones,
      urls,
      names,
      companies,
    } satisfies BusinessCardCandidates,
    notes,
    confidence: {},
  };

  if (emails.length) base.email = emails[0];
  if (urls.length) base.url = urls[0];
  if (phones.length) base.phone = phones[0];

  if (companies.length) {
    base.company = companies[0];
  } else {
    const fallbackCompany = lines.find((l) => !/@/.test(l) && !URL_RE.test(l) && !/\d/.test(l));
    if (fallbackCompany) base.company = fallbackCompany;
  }

  if (names.length) {
    const firstName = names.find((n) => n !== base.company) || names[0];
    base.name = firstName;
  } else {
    notes.push("No clear person-name line detected (best-effort).");
  }

  base.confidence = {
    email: scoreConfidence("email", emails.length),
    url: scoreConfidence("url", urls.length),
    phone: scoreConfidence("phone", phones.length),
    name: scoreConfidence("name", base.name ? 1 : 0),
    company: scoreConfidence("company", base.company ? 1 : 0),
  };

  if (emails.length > 1) notes.push(`Multiple emails found (${emails.length}). Using first.`);
  if (phones.length > 1) notes.push(`Multiple phones found (${phones.length}). Using first.`);
  if (urls.length > 1) notes.push(`Multiple urls found (${urls.length}). Using first.`);

  const result: BusinessCardExtracted = {
    ...base,
    extracted: core(base),
  };

  return result;
}
