"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { adminFetch } from "../../_lib/adminFetch";

type Lead = {
  id: string;
  formId: string;
  capturedAt?: string | null;
  values?: any;
  meta?: any;
  deletedAt?: string | null;
};

type RecipientList = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
};

type ApiOk<T> = { ok: true; status: number; data: T; raw: unknown };
type ApiFail = { ok: false; status: number; error: any; raw: unknown };

function unwrapApi<T = any>(res: any): T {
  if (res && typeof res === "object" && "ok" in res) {
    const r = res as ApiOk<T> | ApiFail;
    if (r.ok) return (r as ApiOk<T>).data;
    const msg =
      (r as ApiFail)?.error?.message ??
      (r as ApiFail)?.error?.error?.message ??
      "Request failed";
    throw new Error(msg);
  }
  return res as T;
}

function pickLead(payload: any): Lead | null {
  return payload?.lead ?? payload ?? null;
}

function pickRecipients(payload: any): RecipientList[] {
  const candidates = payload?.recipients ?? payload?.items ?? payload ?? [];
  return Array.isArray(candidates) ? candidates : [];
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function safeStringify(obj: any) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseJsonStrict(text: string) {
  return JSON.parse(text);
}

function getDevUserId(): string | null {
  try {
    return localStorage.getItem("x-user-id");
  } catch {
    return null;
  }
}

async function postMobileForward(args: {
  leadId: string;
  tenantSlug: string;
  recipientListId: string;
  subject?: string;
  message?: string;
}) {
  const userId = getDevUserId();
  // Mobile endpoint braucht in DEV evtl. auch x-user-id (je nach Guard). Wir senden ihn mit, falls vorhanden.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-slug": args.tenantSlug,
  };
  if (userId) headers["x-user-id"] = userId;

  const res = await fetch(`/api/mobile/v1/leads/${args.leadId}/forward`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      recipientListId: args.recipientListId,
      subject: args.subject?.trim() ? args.subject.trim() : undefined,
      message: args.message?.trim() ? args.message.trim() : undefined,
    }),
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (!res.ok) {
    let msg = `Forward failed (${res.status})`;
    try {
      if (isJson) {
        const j = await res.json();
        msg = j?.error?.message ?? j?.message ?? msg;
      } else {
        const t = await res.text();
        if (t?.trim()) msg = t.trim();
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  if (isJson) return res.json();
  return { ok: true };
}

export default function AdminLeadDetailPage() {
  const params = useParams<{ id: string }>();
  const leadId = params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lead, setLead] = useState<Lead | null>(null);

  // Editor fields
  const [valuesText, setValuesText] = useState<string>("{}");
  const [metaText, setMetaText] = useState<string>("{}");

  // Forward UI state
  const [tenantSlug, setTenantSlug] = useState<string>("");
  const [recipients, setRecipients] = useState<RecipientList[]>([]);
  const [recipientListId, setRecipientListId] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const [forwarding, setForwarding] = useState(false);
  const [forwardResult, setForwardResult] = useState<any>(null);

  const canSave = useMemo(() => {
    return !!leadId && !!lead && !saving;
  }, [leadId, lead, saving]);

  const canForward = useMemo(() => {
    return (
      !!leadId &&
      !forwarding &&
      tenantSlug.trim().length > 0 &&
      recipientListId.trim().length > 0
    );
  }, [leadId, forwarding, tenantSlug, recipientListId]);

  async function loadLead() {
    if (!leadId) return;

    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<any>(`/api/admin/v1/leads/${leadId}`, { method: "GET" });
      const data = unwrapApi<any>(res);
      const l = pickLead(data);

      setLead(l);
      setValuesText(safeStringify(l?.values));
      setMetaText(safeStringify(l?.meta));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load lead.");
      setLead(null);
      setValuesText("{}");
      setMetaText("{}");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecipients() {
    setError(null);
    try {
      const res = await adminFetch<any>("/api/admin/v1/recipients", { method: "GET" });
      const data = unwrapApi<any>(res);
      const lists = pickRecipients(data).filter((r) => (r.active ?? true) === true);

      setRecipients(lists);
      if (!recipientListId && lists.length > 0) {
        setRecipientListId(lists[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load recipient lists.");
      setRecipients([]);
    }
  }

  async function loadTenantSlug() {
    setError(null);
    try {
      const res = await adminFetch<any>("/api/admin/v1/whoami", { method: "GET" });
      const data = unwrapApi<any>(res);

      const slug =
        data?.tenant?.slug ??
        data?.tenantSlug ??
        data?.tenant?.data?.slug ??
        "";

      if (typeof slug === "string" && slug.trim()) {
        setTenantSlug(slug.trim());
      }
    } catch {
      // ignore: user can input slug manually
    }
  }

  async function onSave() {
    if (!leadId || !canSave) return;

    setError(null);
    setSaving(true);
    try {
      const values = parseJsonStrict(valuesText);
      const meta = parseJsonStrict(metaText);

      const res = await adminFetch<any>(`/api/admin/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values, meta }),
      });

      const data = unwrapApi<any>(res);
      const updated = pickLead(data) ?? lead;

      setLead(updated);
      setValuesText(safeStringify(updated?.values ?? values));
      setMetaText(safeStringify(updated?.meta ?? meta));
    } catch (e: any) {
      setError(e?.message ?? "Failed to save lead.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!leadId) return;
    const ok = window.confirm("Lead wirklich soft-delete?");
    if (!ok) return;

    setError(null);
    setSaving(true);
    try {
      const res = await adminFetch<any>(`/api/admin/v1/leads/${leadId}`, { method: "DELETE" });
      // some endpoints return body; unwrap anyway
      unwrapApi<any>(res);
      await loadLead();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete lead.");
    } finally {
      setSaving(false);
    }
  }

  async function onForward() {
    if (!leadId || !canForward) return;

    setError(null);
    setForwardResult(null);
    setForwarding(true);
    try {
      const res = await postMobileForward({
        leadId,
        tenantSlug: tenantSlug.trim(),
        recipientListId: recipientListId.trim(),
        subject,
        message,
      });
      setForwardResult(res);
    } catch (e: any) {
      setError(e?.message ?? "Forward failed.");
    } finally {
      setForwarding(false);
    }
  }

  useEffect(() => {
    loadLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    loadRecipients();
    loadTenantSlug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleted = !!lead?.deletedAt;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin/leads" className="text-sm text-neutral-600 hover:text-neutral-900">
            ← Leads
          </Link>

          <h1 className="mt-2 text-xl font-semibold">Lead Detail</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
              id: {leadId ?? "—"}
            </span>

            <span
              className={[
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                deleted ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700",
              ].join(" ")}
            >
              {deleted ? "deleted" : "active"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadLead}
            className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            disabled={loading || saving || forwarding}
          >
            Refresh
          </button>
          <button
            onClick={onDelete}
            className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            disabled={loading || saving || forwarding}
          >
            Soft-delete
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* Summary */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-neutral-500">Captured</div>
          <div className="mt-1 text-sm font-medium">{formatDateTime(lead?.capturedAt ?? null)}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-neutral-500">Form</div>
          <div className="mt-1 text-sm font-medium">{lead?.formId ?? "—"}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-neutral-500">Deleted At</div>
          <div className="mt-1 text-sm font-medium">{formatDateTime(lead?.deletedAt ?? null)}</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Values */}
        <div className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold">Values (JSON)</h2>
            <button
              onClick={onSave}
              disabled={!canSave}
              className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          <textarea
            className="mt-3 h-80 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-neutral-200"
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            spellCheck={false}
            disabled={loading || saving}
          />
          <p className="mt-2 text-xs text-neutral-500">Hinweis: JSON muss valide sein.</p>
        </div>

        {/* Meta */}
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold">Meta (JSON)</h2>

          <textarea
            className="mt-3 h-80 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-neutral-200"
            value={metaText}
            onChange={(e) => setMetaText(e.target.value)}
            spellCheck={false}
            disabled={loading || saving}
          />

          <div className="mt-2 text-xs text-neutral-500">
            Save-Button ist bei Values-Card (speichert Values + Meta zusammen).
          </div>
        </div>
      </div>

      {/* Forward UI */}
      <div className="mt-6 rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Forward (Stub)</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Ruft <span className="font-mono text-xs">/api/mobile/v1/leads/{leadId}/forward</span>{" "}
              mit <span className="font-mono text-xs">x-tenant-slug</span> auf.
            </p>
          </div>

          <button
            onClick={onForward}
            disabled={!canForward}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {forwarding ? "Forwarding…" : "Forward"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-3">
            <label className="block text-xs font-medium text-neutral-700">Tenant Slug *</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              placeholder="z.B. acme-messe-2026"
              disabled={forwarding}
            />
            <p className="mt-2 text-xs text-neutral-500">
              Wird versucht via <span className="font-mono">/api/admin/v1/whoami</span> zu laden.
              Falls leer: hier manuell setzen.
            </p>
          </div>

          <div className="rounded-md border p-3">
            <label className="block text-xs font-medium text-neutral-700">Recipient List *</label>
            <select
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              value={recipientListId}
              onChange={(e) => setRecipientListId(e.target.value)}
              disabled={forwarding || recipients.length === 0}
            >
              {recipients.length === 0 ? (
                <option value="" disabled>
                  No recipient lists found
                </option>
              ) : (
                recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))
              )}
            </select>
            <p className="mt-2 text-xs text-neutral-500">
              Quelle: <span className="font-mono">/api/admin/v1/recipients</span>
            </p>
          </div>

          <div className="rounded-md border p-3">
            <label className="block text-xs font-medium text-neutral-700">Subject (optional)</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="LeadRadar Messelead"
              disabled={forwarding}
            />
          </div>

          <div className="rounded-md border p-3">
            <label className="block text-xs font-medium text-neutral-700">Message (optional)</label>
            <textarea
              className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Kurzer Hinweis…"
              disabled={forwarding}
            />
          </div>
        </div>

        {forwardResult ? (
          <div className="mt-4 rounded-md border bg-neutral-50 p-3">
            <div className="text-xs font-medium text-neutral-700">Result</div>
            <pre className="mt-2 overflow-auto rounded-md bg-white p-3 text-xs">
{safeStringify(forwardResult)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
