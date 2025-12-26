"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as AdminFetchModule from "../_lib/adminFetch";

type FormLite = { id: string; name?: string | null };

type LeadLite = {
  id: string;
  capturedAt?: string | null;
  createdAt?: string | null;
  formId?: string | null;
  values?: unknown;
  deletedAt?: string | null;
};

function safeJsonPreview(value: unknown, max = 160) {
  try {
    const s = JSON.stringify(value ?? {}, null, 0);
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
  } catch {
    return String(value);
  }
}

function pickItems<T>(resp: any): T[] {
  const data = resp?.data ?? resp;
  if (Array.isArray(data)) return data as T[];
  if (Array.isArray(data?.items)) return data.items as T[];
  if (Array.isArray(resp?.items)) return resp.items as T[];
  return [];
}

function pickTotal(resp: any): number | null {
  const data = resp?.data ?? resp;
  const total =
    (typeof data?.total === "number" && data.total) ||
    (typeof data?.count === "number" && data.count) ||
    (typeof resp?.total === "number" && resp.total) ||
    (typeof resp?.count === "number" && resp.count);

  return typeof total === "number" ? total : null;
}

function parseIntOr(value: string | null, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeDateParam(v: string | null) {
  // expect YYYY-MM-DD (from <input type="date">)
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return "";
}

export default function AdminLeadsPage() {
  const adminFetch: any =
    (AdminFetchModule as any).adminFetch ?? (AdminFetchModule as any).default;

  const canFetch = useMemo(() => typeof adminFetch === "function", [adminFetch]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL-driven state (source of truth)
  const urlQ = (searchParams.get("q") ?? "").toString();
  const urlFormId = (searchParams.get("formId") ?? "").toString();
  const urlIncludeDeleted = (searchParams.get("includeDeleted") ?? "") === "1";
  const urlFrom = normalizeDateParam(searchParams.get("from"));
  const urlTo = normalizeDateParam(searchParams.get("to"));
  const urlPage = parseIntOr(searchParams.get("page"), 1);
  const urlLimit = parseIntOr(searchParams.get("limit"), 20);

  // UI state (editable controls)
  const [q, setQ] = useState(urlQ);
  const [formId, setFormId] = useState(urlFormId);
  const [includeDeleted, setIncludeDeleted] = useState(urlIncludeDeleted);
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  const [limit, setLimit] = useState(urlLimit);

  const [forms, setForms] = useState<FormLite[]>([]);
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep UI state in sync if URL changes (e.g. back/forward)
  useEffect(() => {
    setQ(urlQ);
    setFormId(urlFormId);
    setIncludeDeleted(urlIncludeDeleted);
    setFrom(urlFrom);
    setTo(urlTo);
    setLimit(urlLimit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, urlFormId, urlIncludeDeleted, urlFrom, urlTo, urlLimit]);

  useEffect(() => {
    let cancelled = false;

    async function loadForms() {
      if (!canFetch) return;
      try {
        const resp = await adminFetch("/api/admin/v1/forms?limit=200", { cache: "no-store" });
        const items = pickItems<FormLite>(resp);
        if (!cancelled) setForms(items);
      } catch (e: any) {
        // forms are optional; don't block page
        // keep silent or could set a small warning in UI later
      }
    }

    loadForms();

    return () => {
      cancelled = true;
    };
  }, [canFetch, adminFetch]);

  useEffect(() => {
    let cancelled = false;

    async function loadLeads() {
      if (!canFetch) {
        setLoading(false);
        setError("adminFetch() nicht gefunden. Prüfe Importpfad: app/(admin)/admin/_lib/adminFetch.ts");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (urlQ.trim()) params.set("q", urlQ.trim());
        if (urlFormId) params.set("formId", urlFormId);
        if (urlIncludeDeleted) params.set("includeDeleted", "1");
        if (urlFrom) params.set("from", urlFrom);
        if (urlTo) params.set("to", urlTo);

        params.set("page", String(urlPage));
        params.set("limit", String(urlLimit));

        const resp = await adminFetch(`/api/admin/v1/leads?${params.toString()}`, {
          cache: "no-store",
        });

        const items = pickItems<LeadLite>(resp);
        const t = pickTotal(resp);

        if (!cancelled) {
          setLeads(items);
          setTotal(t);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unbekannter Fehler beim Laden");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadLeads();

    return () => {
      cancelled = true;
    };
  }, [
    canFetch,
    adminFetch,
    urlQ,
    urlFormId,
    urlIncludeDeleted,
    urlFrom,
    urlTo,
    urlPage,
    urlLimit,
  ]);

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onApply() {
    // applying filters resets page to 1
    pushParams({
      q: q.trim() || null,
      formId: formId || null,
      includeDeleted: includeDeleted ? "1" : null,
      from: from || null,
      to: to || null,
      limit: String(limit || 20),
      page: "1",
    });
  }

  function onReset() {
    setQ("");
    setFormId("");
    setIncludeDeleted(false);
    setFrom("");
    setTo("");
    setLimit(20);

    router.push(pathname);
  }

  const hasNext = leads.length === urlLimit && !loading; // heuristic (ohne server-total)
  const hasPrev = urlPage > 1 && !loading;

  function goPrev() {
    if (!hasPrev) return;
    pushParams({ page: String(urlPage - 1) });
  }

  function goNext() {
    if (!hasNext) return;
    pushParams({ page: String(urlPage + 1) });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-slate-600">
            Liste mit Filtern + Paging (API-first via <span className="font-mono">/api/admin/v1/leads</span>)
          </p>
        </div>

        <button
          className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          disabled
          title="Optional: Quick-Export kommt später"
        >
          Export CSV (später)
        </button>
      </header>

      <section className="rounded-lg border border-slate-200 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-4">
            <label className="text-xs font-medium text-slate-600">Suche (q)</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              placeholder="Firma, Name, E-Mail, Text…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onApply();
              }}
            />
          </div>

          <div className="md:col-span-4">
            <label className="text-xs font-medium text-slate-600">Formular (formId)</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
            >
              <option value="">Alle Formulare</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name ? `${f.name} (${f.id})` : f.id}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-600">Von</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-600">Bis</label>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div className="md:col-span-4 flex items-center gap-2 pt-2 md:pt-0">
            <input
              id="includeDeleted"
              type="checkbox"
              className="h-4 w-4"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            <label htmlFor="includeDeleted" className="text-sm text-slate-700">
              includeDeleted
            </label>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-slate-600">Limit</label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <div className="md:col-span-5 flex items-center justify-end gap-2">
            <button
              className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              onClick={onReset}
              disabled={loading}
            >
              Reset
            </button>
            <button
              className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={onApply}
              disabled={loading}
            >
              Filter anwenden
            </button>
          </div>

          <div className="md:col-span-12 text-xs text-slate-500">
            Aktuell: page={urlPage}, limit={urlLimit}
            {urlQ ? `, q="${urlQ}"` : ""}
            {urlFormId ? `, formId=${urlFormId}` : ""}
            {urlIncludeDeleted ? `, includeDeleted=1` : ""}
            {urlFrom ? `, from=${urlFrom}` : ""}
            {urlTo ? `, to=${urlTo}` : ""}
            {total !== null ? `, total=${total}` : ""}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="text-sm font-medium">Liste</div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={goPrev}
              disabled={!hasPrev}
            >
              Prev
            </button>
            <div className="text-xs text-slate-600">Seite {urlPage}</div>
            <button
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              onClick={goNext}
              disabled={!hasNext}
              title={hasNext ? "" : "Kein weiterer Lead (Heuristik: Next wenn items==limit)"}
            >
              Next
            </button>
          </div>
        </div>

        {error ? (
          <div className="p-4 text-sm text-red-700">{error}</div>
        ) : loading ? (
          <div className="p-4 text-sm text-slate-600">Loading leads…</div>
        ) : leads.length === 0 ? (
          <div className="p-4 text-sm text-slate-600">Keine Leads gefunden.</div>
        ) : (
          <div className="w-full overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">capturedAt</th>
                  <th className="px-4 py-2 font-medium">formId</th>
                  <th className="px-4 py-2 font-medium">values</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {leads.map((l) => {
                  const captured = l.capturedAt ?? l.createdAt ?? null;
                  const deleted = Boolean(l.deletedAt);

                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {captured ? new Date(captured).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">{l.formId ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">
                        {safeJsonPreview(l.values)}
                      </td>
                      <td className="px-4 py-2">
                        {deleted ? (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                            deleted
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          className="text-slate-900 underline underline-offset-2"
                          href={`/admin/leads/${l.id}`}
                        >
                          Öffnen
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="text-xs text-slate-500">
        Next: Detail Page <span className="font-mono">/admin/leads/[id]</span> (Load + JSON editor + Soft-delete).
      </section>
    </div>
  );
}
