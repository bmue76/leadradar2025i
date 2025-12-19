// app/api/admin/v1/leads/route.ts
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireTenantContext } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

type LeadListItemDto = {
  id: string;
  formId: string;
  groupId: string | null;
  capturedAt: string; // ISO
  isDeleted: boolean;
  valuesSummary?: string;
  createdAt: string; // ISO
};

function parseIntParam(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolParam(v: string | null): boolean | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (t === "1" || t === "true" || t === "yes" || t === "ja") return true;
  if (t === "0" || t === "false" || t === "no" || t === "nein") return false;
  return null;
}

function parseFrom(v: string | null): Date | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

  // YYYY-MM-DD => UTC start of day (stable)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseToExclusiveOrInclusive(v: string | null): { lt?: Date; lte?: Date } | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;

  // YYYY-MM-DD => exclusive end of that day (next day 00:00Z)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const start = new Date(`${t}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
    const next = new Date(start);
    next.setUTCDate(next.getUTCDate() + 1);
    return { lt: next };
  }

  // full ISO => inclusive
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return { lte: d };
}

function buildValuesSummary(values: unknown): string | undefined {
  if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
  const v = values as Record<string, unknown>;

  const pick = (k: string): string | null => {
    const x = v[k];
    if (typeof x === "string") {
      const t = x.trim();
      return t.length ? t : null;
    }
    if (typeof x === "number" && Number.isFinite(x)) return String(x);
    return null;
  };

  const parts: string[] = [];

  const email = pick("email");
  const company = pick("company") ?? pick("firma") ?? pick("unternehmen");
  const first = pick("firstName") ?? pick("vorname");
  const last = pick("lastName") ?? pick("nachname");
  const name = pick("name") ?? (first || last ? [first, last].filter(Boolean).join(" ") : null);

  if (name) parts.push(name);
  if (company) parts.push(company);
  if (email) parts.push(email);

  // fallback: first 2 string fields
  if (parts.length === 0) {
    const keys = Object.keys(v);
    for (const k of keys) {
      const x = v[k];
      if (typeof x === "string") {
        const t = x.trim();
        if (t) parts.push(t);
      }
      if (parts.length >= 2) break;
    }
  }

  const out = parts.filter(Boolean).join(" · ").trim();
  return out.length ? out : undefined;
}

export async function GET(req: Request) {
  const scoped = await requireTenantContext(req);
  if (!scoped.ok) return scoped.res;

  const url = new URL(req.url);

  const formId = (url.searchParams.get("formId") || "").trim() || null;
  const groupId = (url.searchParams.get("groupId") || "").trim() || null;
  const q = (url.searchParams.get("q") || "").trim() || null;

  const pageRaw = parseIntParam(url.searchParams.get("page"), 1);
  const limitRaw = parseIntParam(url.searchParams.get("limit"), 25);

  const page = Math.max(1, pageRaw);
  const limit = Math.min(200, Math.max(1, limitRaw));

  const includeDeletedParam = parseBoolParam(url.searchParams.get("includeDeleted"));
  if (url.searchParams.has("includeDeleted") && includeDeletedParam === null) {
    return jsonError(req, 400, "BAD_REQUEST", "includeDeleted must be boolean.");
  }
  const includeDeleted = includeDeletedParam === true;

  const from = parseFrom(url.searchParams.get("from"));
  if (url.searchParams.has("from") && !from) {
    return jsonError(req, 400, "BAD_REQUEST", "from must be ISO date/time or YYYY-MM-DD.");
  }

  const toParsed = parseToExclusiveOrInclusive(url.searchParams.get("to"));
  if (url.searchParams.has("to") && !toParsed) {
    return jsonError(req, 400, "BAD_REQUEST", "to must be ISO date/time or YYYY-MM-DD.");
  }

  // leak-safe: optional filters must belong to tenant (formId/groupId)
  if (formId) {
    const f = await prisma.form.findFirst({
      where: { id: formId, tenantId: scoped.ctx.tenantId },
      select: { id: true },
    });
    if (!f) return jsonError(req, 404, "NOT_FOUND", "Form not found.");
  }

  if (groupId) {
    const g = await prisma.group.findFirst({
      where: { id: groupId, tenantId: scoped.ctx.tenantId },
      select: { id: true },
    });
    if (!g) return jsonError(req, 404, "NOT_FOUND", "Group not found.");
  }

  const where: Prisma.LeadWhereInput = {
    tenantId: scoped.ctx.tenantId,
    ...(formId ? { formId } : {}),
    ...(groupId ? { groupId } : {}),
    ...(includeDeleted ? {} : { isDeleted: false }),
    ...(from || toParsed
      ? {
          capturedAt: {
            ...(from ? { gte: from } : {}),
            ...(toParsed?.lt ? { lt: toParsed.lt } : {}),
            ...(toParsed?.lte ? { lte: toParsed.lte } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { clientLeadId: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const total = await prisma.lead.count({ where });

  const itemsRaw = await prisma.lead.findMany({
    where,
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
    select: {
      id: true,
      formId: true,
      groupId: true,
      capturedAt: true,
      isDeleted: true,
      values: true,
      createdAt: true,
    },
  });

  const items: LeadListItemDto[] = itemsRaw.map((l) => ({
    id: l.id,
    formId: l.formId,
    groupId: l.groupId ?? null,
    capturedAt: l.capturedAt.toISOString(),
    isDeleted: l.isDeleted,
    valuesSummary: buildValuesSummary(l.values),
    createdAt: l.createdAt.toISOString(),
  }));

  return jsonOk(req, {
    items,
    paging: { page, limit, total },
  });
}
