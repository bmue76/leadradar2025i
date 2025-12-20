"use client";

import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../_lib/adminFetch";

type FormListItem = {
  id: string;
  name?: string | null;
  title?: string | null;
  status?: string | null;
};

type ExportJob = {
  id: string;
  status?: string | null;
  createdAt?: string | null;
};

function pickForms(payload: any): FormListItem[] {
  const candidates = payload?.data?.forms ?? payload?.data ?? payload?.forms ?? payload?.items ?? [];
  return Array.isArray(candidates) ? candidates : [];
}

function pickExportJob(payload: any): ExportJob | null {
  return payload?.data?.exportJob ?? payload?.data ?? payload?.exportJob ?? payload ?? null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function getDevUserId(): string | null {
  try {
    return localStorage.getItem("x-user-id");
  } catch {
    return null;
  }
}

function parseFilenameFromContentDisposition(cd: string | null): string | null {
  if (!cd) return null;

  // e.g. attachment; filename="export.csv"
  const m1 = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (m1?.[1]) {
    const raw = m1[1].trim().replace(/^"+|"+$/g, "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const m2 = /filename=([^;]+)/i.exec(cd);
  if (m2?.[1]) {
    return m2[1].trim().replace(/^"+|"+$/g, "");
  }

  return null;
}

async function downloadWithAuth(url: string) {
  const userId = getDevUserId();
  if (!userId) throw new Error("DEV Auth fehlt: localStorage key 'x-user-id' ist leer.");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-user-id": userId,
    },
  });

  if (!res.ok) {
    // try read JSON error message
    let msg = `Download failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? j?.message ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const filename =
    parseFilenameFromContentDisposition(res.headers.get("content-disposition")) ?? "export.csv";

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function AdminExportsPage() {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [forms, setForms] = useState<FormListItem[]>([]);
  const [formId, setFormId] = useState<string>("");

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [includeDeleted, setIncludeDeleted] = useState<boolean>(false);
  const [groupId, setGroupId] = useState<string>("");

  const [lastJob, setLastJob] = useState<ExportJob | null>(null);

  const canCreate = useMemo(() => {
    return !!formId && !creating;
  }, [formId, creating]);

  async function loadForms() {
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<any>("/api/admin/v1/forms", { method: "GET" });
      const fs = pickForms(res);
      setForms(fs);

      // preselect first if empty
      if (!formId && fs.length > 0) {
        setFormId(fs[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load forms.");
      setForms([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateExport(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    setError(null);
    setCreating(true);
    try {
      const payload: any = {
        formId,
        includeDeleted: !!includeDeleted,
      };

      if (from.trim()) payload.from = from.trim();
      if (to.trim()) payload.to = to.trim();
      if (groupId.trim()) payload.groupId = groupId.trim();

      const res = await adminFetch<any>("/api/admin/v1/exports/csv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const job = pickExportJob(res);
      if (!job?.id) throw new Error("Export create: missing job id in response.");
      setLastJob(job);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create export.");
      setLastJob(null);
    } finally {
      setCreating(false);
    }
  }

  async function onDownload(jobId: string) {
    setError(null);
    setDownloading(true);
    try {
      await downloadWithAuth(`/api/admin/v1/exports/${jobId}/download`);
    } catch (e: any) {
      setError(e?.message ?? "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    loadForms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Exports (CSV)</h1>
          <p className="mt-1 text-sm text-neutral-600">
            CSV Export erstellen und herunterladen (Job-basiert).
          </p>
        </div>

        <button
          onClick={loadForms}
          className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          disabled={loading || creating || downloading}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Create Export */}
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold">Create Export</h2>

          <form onSubmit={onCreateExport} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700">Form *</label>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                disabled={loading || creating}
                required
              >
                {forms.length === 0 ? (
                  <option value="" disabled>
                    {loading ? "Loading…" : "No forms found"}
                  </option>
                ) : (
                  forms.map((f) => {
                    const label = f.title ?? f.name ?? f.id;
                    return (
                      <option key={f.id} value={f.id}>
                        {label}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-neutral-700">From</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">To</label>
                <input
                  type="date"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={creating}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700">GroupId (optional)</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="z.B. boothA / batch-1"
                disabled={creating}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                disabled={creating}
              />
              Include deleted
            </label>

            <button
              type="submit"
              disabled={!canCreate}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create CSV Export"}
            </button>

            <p className="text-xs text-neutral-500">
              Hinweis: Download kann 404 liefern, solange der Job noch nicht bereit ist.
            </p>
          </form>
        </div>

        {/* Last Job */}
        <div className="rounded-lg border bg-white p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Last Export Job</h2>
            {lastJob ? (
              <span className="text-xs text-neutral-500">id: {lastJob.id}</span>
            ) : (
              <span className="text-xs text-neutral-500">—</span>
            )}
          </div>

          <div className="mt-4">
            {!lastJob ? (
              <div className="text-sm text-neutral-600">
                Noch kein Export erstellt. Nutze links “Create CSV Export”.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border bg-white p-3">
                    <div className="text-xs text-neutral-500">Status</div>
                    <div className="mt-1 text-sm font-medium">
                      {lastJob.status ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <div className="text-xs text-neutral-500">Created</div>
                    <div className="mt-1 text-sm font-medium">
                      {formatDateTime(lastJob.createdAt)}
                    </div>
                  </div>
                  <div className="rounded-md border bg-white p-3">
                    <div className="text-xs text-neutral-500">Download</div>
                    <div className="mt-2">
                      <button
                        onClick={() => onDownload(lastJob.id)}
                        disabled={downloading}
                        className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {downloading ? "Downloading…" : "Download CSV"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-neutral-500">
                  Wenn Download fehlschlägt: Fehlermeldung oben beachten (z.B. “not ready”/404).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
