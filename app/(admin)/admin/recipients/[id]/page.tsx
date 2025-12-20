"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { adminFetch } from "../../_lib/adminFetch";

type Recipient = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  createdAt?: string;
};

type RecipientEntry = {
  id: string;
  email: string;
  name?: string | null;
  createdAt?: string;
};

function pickRecipient(payload: any): Recipient | null {
  return (
    payload?.data?.recipient ??
    payload?.data ??
    payload?.recipient ??
    payload ??
    null
  );
}

function pickEntries(payload: any): RecipientEntry[] {
  const candidates =
    payload?.data?.entries ?? payload?.data ?? payload?.entries ?? payload?.items ?? [];
  return Array.isArray(candidates) ? candidates : [];
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function AdminRecipientDetailPage() {
  const params = useParams<{ id: string }>();
  const recipientId = params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [entries, setEntries] = useState<RecipientEntry[]>([]);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  const canAdd = useMemo(() => {
    const e = email.trim();
    return e.length > 3 && e.includes("@") && !saving;
  }, [email, saving]);

  async function loadAll() {
    if (!recipientId) return;
    setError(null);
    setLoading(true);
    try {
      const [r, e] = await Promise.all([
        adminFetch<any>(`/api/admin/v1/recipients/${recipientId}`, { method: "GET" }),
        adminFetch<any>(`/api/admin/v1/recipients/${recipientId}/entries`, { method: "GET" }),
      ]);

      setRecipient(pickRecipient(r));
      setEntries(pickEntries(e));
    } catch (err: any) {
      setError(err?.message ?? "Failed to load recipient details.");
      setRecipient(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  async function onAddEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!recipientId || !canAdd) return;

    setError(null);
    setSaving(true);
    try {
      await adminFetch<any>(`/api/admin/v1/recipients/${recipientId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: displayName.trim() ? displayName.trim() : null,
        }),
      });

      setEmail("");
      setDisplayName("");
      const refreshed = await adminFetch<any>(`/api/admin/v1/recipients/${recipientId}/entries`, {
        method: "GET",
      });
      setEntries(pickEntries(refreshed));
    } catch (err: any) {
      setError(err?.message ?? "Failed to add entry.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteEntry(entryId: string) {
    if (!recipientId) return;
    const ok = window.confirm("Entry wirklich löschen?");
    if (!ok) return;

    setError(null);
    setSaving(true);
    try {
      await adminFetch<any>(`/api/admin/v1/recipients/${recipientId}/entries/${entryId}`, {
        method: "DELETE",
      });

      setEntries((prev) => prev.filter((x) => x.id !== entryId));
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete entry.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientId]);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/recipients"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              ← Recipients
            </Link>
          </div>

          <h1 className="mt-2 text-xl font-semibold">
            {loading ? "Recipient…" : recipient?.name ?? "Recipient"}
          </h1>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
              id: {recipientId ?? "—"}
            </span>

            <span
              className={[
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                (recipient?.active ?? true)
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-neutral-100 text-neutral-700",
              ].join(" ")}
            >
              {(recipient?.active ?? true) ? "active" : "inactive"}
            </span>
          </div>

          {recipient?.description ? (
            <p className="mt-2 max-w-3xl text-sm text-neutral-700">{recipient.description}</p>
          ) : null}
        </div>

        <button
          onClick={loadAll}
          className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          disabled={loading || saving}
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
        {/* Add Entry */}
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold">Entry hinzufügen</h2>

          <form onSubmit={onAddEntry} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700">Email *</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@firma.ch"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Name (optional)
              </label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Max Muster"
              />
            </div>

            <button
              type="submit"
              disabled={!canAdd}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add Entry"}
            </button>

            <p className="text-xs text-neutral-500">
              Nächster Schritt: Edit/Delete List auf der Overview-Seite.
            </p>
          </form>
        </div>

        {/* Entries table */}
        <div className="rounded-lg border bg-white p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Entries</h2>
            {loading ? (
              <span className="text-xs text-neutral-500">Loading…</span>
            ) : (
              <span className="text-xs text-neutral-500">{entries.length} items</span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="border-b text-left text-xs text-neutral-500">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 pr-0 text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-4 text-sm text-neutral-600" colSpan={4}>
                      Loading entries…
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td className="py-4 text-sm text-neutral-600" colSpan={4}>
                      Keine Entries vorhanden.
                    </td>
                  </tr>
                ) : (
                  entries.map((en) => (
                    <tr key={en.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 text-sm font-medium text-neutral-900">
                        {en.email}
                      </td>
                      <td className="py-2 pr-3 text-sm text-neutral-700">
                        {en.name ? en.name : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="py-2 pr-3 text-sm text-neutral-700">
                        {formatDateTime(en.createdAt)}
                      </td>
                      <td className="py-2 pr-0 text-right">
                        <button
                          onClick={() => onDeleteEntry(en.id)}
                          disabled={saving}
                          className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-neutral-500">
            Hinweis: Duplicate Emails/Validierung kommt über API; UI ist minimal.
          </div>
        </div>
      </div>
    </div>
  );
}
