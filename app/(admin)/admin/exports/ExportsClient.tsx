"use client";

// app/(admin)/admin/exports/ExportsClient.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type ExportStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | string;

type ExportListItem = {
  id: string;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  formId: string | null;
  groupId: string | null;
  canDownload: boolean;
  downloadUrl: string | null;
};

type ExportListResponse = {
  items: ExportListItem[];
  meta: { page: number; take: number; total: number; hasMore: boolean };
};

type ExportDetailResponse = {
  id: string;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  formId: string | null;
  groupId: string | null;
  canDownload: boolean;
  downloadUrl: string | null;
  errorMessage: string | null;
};

type ApiOk<T> = { ok: true; data: T; traceId?: string };
type ApiErr = { ok: false; error: { message: string; code?: string; details?: unknown }; traceId?: string };

function fmtDate(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function statusBadge(status: ExportStatus) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
  switch (status) {
    case "DONE":
      return <span className={`${base} bg-green-100 text-green-800`}>DONE</span>;
    case "FAILED":
      return <span className={`${base} bg-red-100 text-red-800`}>FAILED</span>;
    case "RUNNING":
      return <span className={`${base} bg-blue-100 text-blue-800`}>RUNNING</span>;
    case "QUEUED":
      return <span className={`${base} bg-zinc-100 text-zinc-800`}>QUEUED</span>;
    default:
      return <span className={`${base} bg-zinc-100 text-zinc-800`}>{String(status)}</span>;
  }
}

/**
 * Tenant/User Header Strategy (dev-friendly):
 * - Uses localStorage keys if set:
 *   - LR_TENANT_ID
 *   - LR_USER_ID
 * - Fallback: NEXT_PUBLIC_DEV_TENANT_ID / NEXT_PUBLIC_DEV_USER_ID
 */
function getAuthHeaders(): Record<string, string> {
  const tenantId =
    (typeof window !== "undefined" && window.localStorage.getItem("LR_TENANT_ID")) ||
    process.env.NEXT_PUBLIC_DEV_TENANT_ID ||
    "";
  const userId =
    (typeof window !== "undefined" && window.localStorage.getItem("LR_USER_ID")) ||
    process.env.NEXT_PUBLIC_DEV_USER_ID ||
    "";

  const headers: Record<string, string> = {};
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (userId) headers["x-user-id"] = userId;
  return headers;
}

async function apiFetchJson<T>(input: string, init?: RequestInit): Promise<ApiOk<T>> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
      ...getAuthHeaders(),
    },
  });

  const json = (await res.json()) as ApiOk<T> | ApiErr;

  if (!json || typeof json !== "object") {
    throw new Error(`Invalid API response (${res.status})`);
  }
  if ((json as ApiErr).ok === false) {
    const e = json as ApiErr;
    const msg = e.error?.message || `API error (${res.status})`;
    const trace = e.traceId ? ` | traceId=${e.traceId}` : "";
    throw new Error(`${msg}${trace}`);
  }
  return json as ApiOk<T>;
}

async function apiFetchBlob(input: string, init?: RequestInit): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...getAuthHeaders(),
    },
  });

  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const j = (await res.json()) as ApiErr;
      if (j?.ok === false && j.error?.message) msg = j.error.message + (j.traceId ? ` | traceId=${j.traceId}` : "");
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const cd = res.headers.get("content-disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?("?)([^"]+)\1/i.exec(cd);
  const filename = match?.[2] ? decodeURIComponent(match[2]) : "export.csv";

  const blob = await res.blob();
  return { blob, filename };
}

export default function ExportsClient() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [take, setTake] = useState(20);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterFormId, setFilterFormId] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");

  const [jobs, setJobs] = useState<ExportListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Create Export form
  const [newFormId, setNewFormId] = useState("");
  const [newGroupId, setNewGroupId] = useState("");

  // Polling
  const pollIntervalRef = useRef<number | null>(null);
  const pollStartedAtRef = useRef<Map<string, number>>(new Map());
  const POLL_EVERY_MS = 2000;
  const POLL_TIMEOUT_MS = 120000; // 2min

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("take", String(take));
    if (filterStatus) sp.set("status", filterStatus);
    if (filterFormId.trim()) sp.set("formId", filterFormId.trim());
    if (filterGroupId.trim()) sp.set("groupId", filterGroupId.trim());
    return sp.toString();
  }, [page, take, filterStatus, filterFormId, filterGroupId]);

  async function loadList(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const r = await apiFetchJson<ExportListResponse>(`/api/admin/v1/exports?${queryString}`, { method: "GET" });
      setJobs(r.data.items);
      setTotal(r.data.meta.total);
      setHasMore(r.data.meta.hasMore);

      // mark queued/running jobs for polling
      const now = Date.now();
      const map = pollStartedAtRef.current;
      for (const j of r.data.items) {
        if ((j.status === "QUEUED" || j.status === "RUNNING") && !map.has(j.id)) map.set(j.id, now);
      }
    } catch (e: any) {
      setError(e?.message || "Fehler beim Laden der Exports.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadDetail(jobId: string) {
    const r = await apiFetchJson<ExportDetailResponse>(`/api/admin/v1/exports/${jobId}`, { method: "GET" });
    const d = r.data;
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: d.status,
              createdAt: d.createdAt,
              updatedAt: d.updatedAt,
              formId: d.formId,
              groupId: d.groupId,
              canDownload: d.canDownload,
              downloadUrl: d.downloadUrl,
            }
          : j,
      ),
    );
    return d;
  }

  function startPolling() {
    if (pollIntervalRef.current) return;

    pollIntervalRef.current = window.setInterval(async () => {
      const map = pollStartedAtRef.current;
      const now = Date.now();

      const activeIds = jobs
        .filter((j) => j.status === "QUEUED" || j.status === "RUNNING")
        .map((j) => j.id);

      if (activeIds.length === 0) return;

      for (const id of activeIds) {
        const startedAt = map.get(id) ?? now;
        if (!map.has(id)) map.set(id, startedAt);

        if (now - startedAt > POLL_TIMEOUT_MS) {
          map.delete(id);
          continue;
        }

        try {
          const detail = await loadDetail(id);
          if (detail.status === "DONE" || detail.status === "FAILED") {
            map.delete(id);
            void loadList({ silent: true });
          }
        } catch {
          // keep polling; errors are not fatal per tick
        }
      }
    }, POLL_EVERY_MS);
  }

  function stopPolling() {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  async function onCreateExport() {
    setBusy(true);
    setError(null);

    try {
      const formId = newFormId.trim();
      const groupId = newGroupId.trim();

      if (!formId) {
        setError("formId ist erforderlich.");
        return;
      }

      const body: any = { formId };
      if (groupId) body.groupId = groupId;

      const r = await apiFetchJson<{ id: string; status: ExportStatus; downloadUrl?: string | null }>(
        "/api/admin/v1/exports/csv",
        { method: "POST", body: JSON.stringify(body) },
      );

      const id = r.data.id;
      pollStartedAtRef.current.set(id, Date.now());

      await loadList({ silent: true });

      try {
        await loadDetail(id);
      } catch {
        // interval will continue
      }
    } catch (e: any) {
      setError(e?.message || "Fehler beim Starten des Exports.");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(job: ExportListItem) {
    setBusy(true);
    setError(null);

    try {
      if (!job.downloadUrl) throw new Error("Export ist noch nicht bereit.");
      const { blob, filename } = await apiFetchBlob(job.downloadUrl, { method: "GET" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "export.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "Download fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const activeCount = jobs.filter((j) => j.status === "QUEUED" || j.status === "RUNNING").length;

  return (
    <div className="space-y-6">
      {/* Create */}
      <section className="rounded-lg border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Neuen CSV-Export starten</h2>
            <p className="text-sm opacity-70">Startet einen Export-Job. Danach wird der Status automatisch gepollt.</p>
          </div>
          <button
            className="rounded-md border px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
            onClick={() => loadList()}
            disabled={loading || busy}
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">formId *</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="cmxxxx..."
              value={newFormId}
              onChange={(e) => setNewFormId(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">groupId (optional)</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="cmxxxx..."
              value={newGroupId}
              onChange={(e) => setNewGroupId(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="flex items-end">
            <button
              className="w-full rounded-md bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={onCreateExport}
              disabled={busy}
            >
              {busy ? "Bitte warten…" : "Export starten"}
            </button>
          </div>
        </div>

        {activeCount > 0 ? (
          <div className="mt-3 text-xs opacity-70">Polling aktiv: {activeCount} Job(s) in Arbeit.</div>
        ) : (
          <div className="mt-3 text-xs opacity-70">Keine aktiven Jobs.</div>
        )}
      </section>

      {/* Filters */}
      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Letzte Exports</h2>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">Status</label>
            <select
              className="rounded-md border px-3 py-2 text-sm"
              value={filterStatus}
              onChange={(e) => {
                setPage(1);
                setFilterStatus(e.target.value);
              }}
              disabled={loading}
            >
              <option value="">Alle</option>
              <option value="QUEUED">QUEUED</option>
              <option value="RUNNING">RUNNING</option>
              <option value="DONE">DONE</option>
              <option value="FAILED">FAILED</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">formId</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="Filter…"
              value={filterFormId}
              onChange={(e) => {
                setPage(1);
                setFilterFormId(e.target.value);
              }}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">groupId</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              placeholder="Filter…"
              value={filterGroupId}
              onChange={(e) => {
                setPage(1);
                setFilterGroupId(e.target.value);
              }}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">Take</label>
            <select
              className="rounded-md border px-3 py-2 text-sm"
              value={take}
              onChange={(e) => {
                setPage(1);
                setTake(Number(e.target.value));
              }}
              disabled={loading}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <div className="mt-4 text-sm opacity-70">Lade Exports…</div>
        ) : jobs.length === 0 ? (
          <div className="mt-4 text-sm opacity-70">Keine Exports gefunden.</div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Export-ID</th>
                  <th className="py-2 pr-3">formId</th>
                  <th className="py-2 pr-3">groupId</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-0 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b">
                    <td className="py-2 pr-3">{statusBadge(j.status)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.id}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.formId ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{j.groupId ?? "—"}</td>
                    <td className="py-2 pr-3">{fmtDate(j.createdAt)}</td>
                    <td className="py-2 pr-3">{fmtDate(j.updatedAt)}</td>
                    <td className="py-2 pr-0 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                          onClick={() => loadDetail(j.id)}
                          disabled={busy}
                          title="Status neu laden"
                        >
                          Status
                        </button>

                        <button
                          className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                          onClick={() => onDownload(j)}
                          disabled={busy || !j.canDownload || !j.downloadUrl}
                          title={j.canDownload ? "CSV herunterladen" : "Noch nicht bereit"}
                        >
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs opacity-70">
                Total: {total} • Page: {page} • Has more: {hasMore ? "yes" : "no"}
              </div>

              <div className="flex gap-2">
                <button
                  className="rounded-md border px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || page <= 1}
                >
                  Zurück
                </button>
                <button
                  className="rounded-md border px-3 py-2 text-xs hover:bg-zinc-50 disabled:opacity-50"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || !hasMore}
                >
                  Weiter
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Dev helper */}
      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Dev-Header (optional)</h3>
        <p className="mt-1 text-xs opacity-70">
          Wenn dein <code className="rounded bg-zinc-100 px-1">requireTenantContext</code> Header erwartet:
          Setze <code className="rounded bg-zinc-100 px-1">LR_TENANT_ID</code> und{" "}
          <code className="rounded bg-zinc-100 px-1">LR_USER_ID</code> in localStorage.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">LR_TENANT_ID</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              defaultValue={typeof window !== "undefined" ? window.localStorage.getItem("LR_TENANT_ID") || "" : ""}
              onBlur={(e) => window.localStorage.setItem("LR_TENANT_ID", e.target.value.trim())}
              placeholder="cmxxxx..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold opacity-70">LR_USER_ID</label>
            <input
              className="rounded-md border px-3 py-2 text-sm"
              defaultValue={typeof window !== "undefined" ? window.localStorage.getItem("LR_USER_ID") || "" : ""}
              onBlur={(e) => window.localStorage.setItem("LR_USER_ID", e.target.value.trim())}
              placeholder="cmxxxx..."
            />
          </div>
        </div>

        <div className="mt-3">
          <button
            className="rounded-md border px-3 py-2 text-xs hover:bg-zinc-50"
            onClick={() => loadList()}
            disabled={loading || busy}
          >
            Mit neuen Headers neu laden
          </button>
        </div>
      </section>
    </div>
  );
}
