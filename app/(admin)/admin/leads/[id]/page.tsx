"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as AdminFetchModule from "../../_lib/adminFetch";

type LeadAttachmentLite = {
  id?: string;
  filename?: string | null;
  contentType?: string | null;
  createdAt?: string | null;
};

type LeadDetail = {
  id: string;
  formId?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;

  deletedAt?: string | null;
  deletedReason?: string | null;

  values?: unknown;
  meta?: unknown;

  attachments?: LeadAttachmentLite[] | null;

  // optional fields that may exist (we display safely if present)
  clientLeadId?: string | null;
};

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{\n  \n}";
  }
}

function tryParseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    const v = JSON.parse(text);
    return { ok: true, value: v };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Invalid JSON" };
  }
}

function pickLead(resp: any): LeadDetail | null {
  const data = resp?.data ?? resp;
  if (!data) return null;
  // some APIs return { ok:true, data:{ lead: {...} } }
  if (data?.lead && typeof data.lead === "object") return data.lead as LeadDetail;
  if (typeof data === "object") return data as LeadDetail;
  return null;
}

export default function AdminLeadDetailPage() {
  const adminFetch: any =
    (AdminFetchModule as any).adminFetch ?? (AdminFetchModule as any).default;

  const canFetch = useMemo(() => typeof adminFetch === "function", [adminFetch]);

  const params = useParams();
  const router = useRouter();

  const rawId = (params as any)?.id;
  const leadId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [valuesText, setValuesText] = useState<string>("");
  const [metaText, setMetaText] = useState<string>("");

  const [valuesError, setValuesError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [deleteReason, setDeleteReason] = useState<string>("");

  async function reload() {
    if (!canFetch) {
      setLoading(false);
      setError("adminFetch() nicht gefunden. Prüfe Importpfad: app/(admin)/admin/_lib/adminFetch.ts");
      return;
    }
    if (!leadId) {
      setLoading(false);
      setError("Keine Lead-ID in Route gefunden.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await adminFetch(`/api/admin/v1/leads/${encodeURIComponent(leadId)}`, {
        cache: "no-store",
      });
      const l = pickLead(resp);
      if (!l) throw new Error("Lead-Response leer oder unerwartetes Format.");

      setLead(l);
      setValuesText(safeStringify(l.values));
      setMetaText(safeStringify(l.meta));
      setValuesError(null);
      setMetaError(null);
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler beim Laden");
      setLead(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, canFetch]);

  async function onSave() {
    if (!leadId) return;

    const pv = tryParseJson(valuesText);
    const pm = tryParseJson(metaText);

    setValuesError(pv.ok ? null : pv.error);
    setMetaError(pm.ok ? null : pm.error);

    if (!pv.ok || !pm.ok) return;

    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/v1/leads/${encodeURIComponent(leadId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: pv.value,
          meta: pm.value,
        }),
        cache: "no-store",
      });

      await reload();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!leadId) return;
    if (lead?.deletedAt) return;

    const ok = window.confirm("Lead wirklich soft-deleten?");
    if (!ok) return;

    setDeleting(true);
    setError(null);
    try {
      const body =
        deleteReason.trim().length > 0 ? JSON.stringify({ reason: deleteReason.trim() }) : undefined;

      await adminFetch(`/api/admin/v1/leads/${encodeURIComponent(leadId)}`, {
        method: "DELETE",
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
        cache: "no-store",
      });

      await reload();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Unbekannter Fehler beim Löschen");
    } finally {
      setDeleting(false);
    }
  }

  const capturedAt = lead?.capturedAt ?? lead?.createdAt ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-sm text-slate-600">
            <Link className="underline underline-offset-2" href="/admin/leads">
              ← zurück zur Liste
            </Link>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Lead Detail</h1>

          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="font-mono text-slate-900">{leadId ?? "—"}</span>
            {lead?.formId ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                formId: <span className="font-mono">{lead.formId}</span>
              </span>
            ) : null}
            {capturedAt ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                capturedAt: {new Date(capturedAt).toLocaleString()}
              </span>
            ) : null}

            {lead?.deletedAt ? (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                deleted
              </span>
            ) : (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                active
              </span>
            )}
          </div>

          {lead?.deletedAt ? (
            <div className="text-xs text-slate-500">
              deletedAt: {new Date(lead.deletedAt).toLocaleString()}
              {lead.deletedReason ? ` • reason: ${lead.deletedReason}` : ""}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={reload}
            disabled={loading || saving || deleting}
          >
            Refresh
          </button>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={onSave}
            disabled={loading || saving || deleting}
          >
            {saving ? "Speichern…" : "Save"}
          </button>
        </div>
      </header>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <div className="text-sm text-slate-600">Loading lead…</div>
      ) : !lead ? (
        <div className="text-sm text-slate-600">Lead nicht gefunden.</div>
      ) : (
        <>
          {/* Values */}
          <section className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-medium">1) Values (JSON)</div>
              {valuesError ? (
                <div className="text-xs text-red-700">JSON Fehler: {valuesError}</div>
              ) : (
                <div className="text-xs text-slate-500">Clientseitig validiert vor PATCH</div>
              )}
            </div>
            <div className="p-4">
              <textarea
                className="min-h-[260px] w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
                value={valuesText}
                onChange={(e) => {
                  setValuesText(e.target.value);
                  setValuesError(null);
                }}
                spellCheck={false}
              />
            </div>
          </section>

          {/* Meta */}
          <section className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-medium">2) Meta (JSON)</div>
              {metaError ? (
                <div className="text-xs text-red-700">JSON Fehler: {metaError}</div>
              ) : (
                <div className="text-xs text-slate-500">Clientseitig validiert vor PATCH</div>
              )}
            </div>
            <div className="p-4">
              <textarea
                className="min-h-[220px] w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-xs"
                value={metaText}
                onChange={(e) => {
                  setMetaText(e.target.value);
                  setMetaError(null);
                }}
                spellCheck={false}
              />
            </div>
          </section>

          {/* Attachments */}
          <section className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="text-sm font-medium">3) Attachments</div>
              <div className="text-xs text-slate-500">
                {(lead.attachments?.length ?? 0).toString()} file(s)
              </div>
            </div>

            {!lead.attachments || lead.attachments.length === 0 ? (
              <div className="p-4 text-sm text-slate-600">Keine Attachments.</div>
            ) : (
              <div className="w-full overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="text-left">
                      <th className="px-4 py-2 font-medium">filename</th>
                      <th className="px-4 py-2 font-medium">type</th>
                      <th className="px-4 py-2 font-medium">createdAt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {lead.attachments.map((a, idx) => (
                      <tr key={a.id ?? `${idx}`}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-800">
                          {a.filename ?? "—"}
                        </td>
                        <td className="px-4 py-2">{a.contentType ?? "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {a.createdAt ? new Date(a.createdAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Danger zone */}
          <section className="rounded-lg border border-red-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-red-200 flex items-center justify-between bg-red-50">
              <div className="text-sm font-medium text-red-800">Danger Zone</div>
              <div className="text-xs text-red-700">Soft-delete (DELETE)</div>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="text-xs text-slate-600">
                Optional: Reason wird (wenn API unterstützt) im DELETE-Body gesendet.
              </div>

              <input
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                placeholder="Reason (optional)…"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                disabled={Boolean(lead.deletedAt) || deleting || saving || loading}
              />

              <div className="flex items-center gap-2">
                <button
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                  onClick={onDelete}
                  disabled={Boolean(lead.deletedAt) || deleting || saving || loading}
                  title={lead.deletedAt ? "Bereits deleted" : ""}
                >
                  {deleting ? "Löschen…" : "Soft-delete"}
                </button>

                {lead.deletedAt ? (
                  <div className="text-xs text-slate-500">
                    Lead ist deleted. (Undelete ist in diesem MVP nicht vorgesehen.)
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
