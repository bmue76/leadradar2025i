"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../_lib/adminFetch";

type Recipient = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean | null;
  entryCount?: number | null;
  createdAt?: string;
};

function pickRecipients(payload: any): Recipient[] {
  const candidates =
    payload?.data?.recipients ??
    payload?.data ??
    payload?.recipients ??
    payload?.items ??
    [];
  return Array.isArray(candidates) ? candidates : [];
}

export default function AdminRecipientsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editActive, setEditActive] = useState(true);

  const canSubmitCreate = useMemo(
    () => name.trim().length > 0 && !saving,
    [name, saving]
  );

  const canSubmitEdit = useMemo(() => {
    return editName.trim().length > 0 && !!editId && !saving;
  }, [editName, editId, saving]);

  async function loadRecipients() {
    setError(null);
    setLoading(true);
    try {
      const res = await adminFetch<any>("/api/admin/v1/recipients", {
        method: "GET",
      });
      setRecipients(pickRecipients(res));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load recipients.");
      setRecipients([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitCreate) return;

    setError(null);
    setSaving(true);
    try {
      await adminFetch<any>("/api/admin/v1/recipients", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
        }),
      });

      setName("");
      setDescription("");
      await loadRecipients();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create recipient list.");
    } finally {
      setSaving(false);
    }
  }

  function openEditModal(r: Recipient) {
    setError(null);
    setEditId(r.id);
    setEditName(r.name ?? "");
    setEditDescription(r.description ?? "");
    setEditActive(r.active ?? true);
    setEditOpen(true);
  }

  function closeEditModal() {
    if (saving) return;
    setEditOpen(false);
    setEditId(null);
    setEditName("");
    setEditDescription("");
    setEditActive(true);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitEdit || !editId) return;

    setError(null);
    setSaving(true);
    try {
      await adminFetch<any>(`/api/admin/v1/recipients/${editId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() ? editDescription.trim() : null,
          active: !!editActive,
        }),
      });

      setRecipients((prev) =>
        prev.map((x) =>
          x.id === editId
            ? {
                ...x,
                name: editName.trim(),
                description: editDescription.trim() ? editDescription.trim() : null,
                active: !!editActive,
              }
            : x
        )
      );

      closeEditModal();
    } catch (e: any) {
      setError(e?.message ?? "Failed to update recipient list.");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteList(id: string) {
    const ok = window.confirm("Recipient List wirklich löschen?");
    if (!ok) return;

    setError(null);
    setSaving(true);
    try {
      await adminFetch<any>(`/api/admin/v1/recipients/${id}`, {
        method: "DELETE",
      });

      setRecipients((prev) => prev.filter((x) => x.id !== id));

      if (editOpen && editId === id) closeEditModal();
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete recipient list.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Recipients</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Recipient Lists verwalten (Liste + Create + Edit + Delete).
          </p>
        </div>

        <button
          onClick={loadRecipients}
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
        {/* Create */}
        <div className="rounded-lg border bg-white p-4">
          <h2 className="text-sm font-semibold">Neue Recipient List</h2>

          <form onSubmit={onCreate} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-700">Name *</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Sales Team"
                required
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Description (optional)
              </label>
              <textarea
                className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Kurzbeschreibung…"
                disabled={saving}
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmitCreate}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create"}
            </button>

            <p className="text-xs text-neutral-500">
              Nächster Schritt (2.3): Exports UI + Forward UI.
            </p>
          </form>
        </div>

        {/* List */}
        <div className="rounded-lg border bg-white p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Listen</h2>
            {loading ? (
              <span className="text-xs text-neutral-500">Loading…</span>
            ) : (
              <span className="text-xs text-neutral-500">{recipients.length} items</span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="border-b text-left text-xs text-neutral-500">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">#Entries</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-0 text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-4 text-sm text-neutral-600" colSpan={5}>
                      Loading recipients…
                    </td>
                  </tr>
                ) : recipients.length === 0 ? (
                  <tr>
                    <td className="py-4 text-sm text-neutral-600" colSpan={5}>
                      Keine Recipient Lists vorhanden.
                    </td>
                  </tr>
                ) : (
                  recipients.map((r) => {
                    const active = r.active ?? true;
                    const count =
                      typeof r.entryCount === "number" ? String(r.entryCount) : "—";

                    return (
                      <tr key={r.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 text-sm font-medium text-neutral-900">
                          {r.name}
                        </td>
                        <td className="py-2 pr-3 text-sm">
                          <span
                            className={[
                              "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                              active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-neutral-100 text-neutral-700",
                            ].join(" ")}
                          >
                            {active ? "active" : "inactive"}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-sm text-neutral-700">{count}</td>
                        <td className="py-2 pr-3 text-sm text-neutral-700">
                          {r.description ? (
                            <span className="line-clamp-2">{r.description}</span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-0 text-right">
                          <div className="inline-flex items-center gap-2">
                            <Link
                              href={`/admin/recipients/${r.id}`}
                              className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50"
                            >
                              Öffnen
                            </Link>
                            <button
                              onClick={() => openEditModal(r)}
                              disabled={saving}
                              className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => onDeleteList(r.id)}
                              disabled={saving}
                              className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-neutral-500">
            Hinweis: #Entries wird angezeigt, falls die API das Feld liefert (z.B. entryCount).
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeEditModal}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-lg border bg-white p-4 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">Edit Recipient List</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  id: <span className="font-mono">{editId}</span>
                </p>
              </div>
              <button
                onClick={closeEditModal}
                disabled={saving}
                className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <form onSubmit={onSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700">Name *</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700">
                  Description (optional)
                </label>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  disabled={saving}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  disabled={saving}
                />
                Active
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={saving}
                  className="rounded-md border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmitEdit}
                  className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
