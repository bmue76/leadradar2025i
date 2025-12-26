'use client';

import * as React from 'react';
import { adminFetch } from '../../../_lib/adminFetch';

type Form = any;
type Field = any;

function pickName(f: Form): string {
  return f?.name ?? f?.title ?? f?.label ?? f?.slug ?? 'Form';
}

function pickDescription(f: Form): string {
  const d = f?.description;
  if (typeof d === 'string') return d;
  return '';
}

function pickStatus(f: Form): string {
  return (f?.status ?? f?.formStatus ?? 'UNKNOWN') as string;
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';
  const style =
    s === 'ACTIVE'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : s === 'DRAFT'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : s === 'ARCHIVED'
          ? 'border-slate-200 bg-slate-50 text-slate-700'
          : 'border-slate-200 bg-white text-slate-700';
  return <span className={`${base} ${style}`}>{s}</span>;
}

function nextPrimaryAction(status: string): { label: string; toStatus: 'DRAFT' | 'ACTIVE' } | null {
  const s = String(status || 'UNKNOWN').toUpperCase();
  if (s === 'DRAFT') return { label: 'Aktivieren', toStatus: 'ACTIVE' };
  if (s === 'ACTIVE') return { label: 'Deaktivieren', toStatus: 'DRAFT' };
  if (s === 'ARCHIVED') return { label: 'Reaktivieren', toStatus: 'ACTIVE' };
  return null;
}

function normalizeForm(rawData: any): Form {
  const d = rawData;
  if (d?.form) return d.form;
  if (d?.item) return d.item;
  return d;
}

function normalizeFields(rawData: any): Field[] {
  const d = rawData;

  if (Array.isArray(d?.fields)) return d.fields;
  if (Array.isArray(d?.form?.fields)) return d.form.fields;
  if (Array.isArray(d?.items)) return d.items;

  if (Array.isArray(d?.formFields)) return d.formFields;

  return [];
}

function fieldOrderValue(field: Field): number {
  const v =
    field?.sortOrder ??
    field?.order ??
    field?.position ??
    field?.sortIndex ??
    field?.index;

  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);

  return 999999;
}

function pickFieldLabel(field: Field): string {
  return field?.label ?? field?.name ?? field?.title ?? field?.key ?? 'Field';
}

function pickFieldKey(field: Field): string {
  return field?.key ?? field?.fieldKey ?? '';
}

function pickFieldType(field: Field): string {
  return field?.type ?? field?.fieldType ?? '';
}

function pickFieldRequired(field: Field): boolean | null {
  const v = field?.required ?? field?.isRequired;
  if (typeof v === 'boolean') return v;
  return null;
}

function pickFieldActive(field: Field): boolean | null {
  const v = field?.active ?? field?.isActive;
  if (typeof v === 'boolean') return v;
  return null;
}

function pickFieldPlaceholder(field: Field): string {
  const v = field?.placeholder;
  return typeof v === 'string' ? v : '';
}

function pickFieldHelpText(field: Field): string {
  const v = field?.helpText;
  return typeof v === 'string' ? v : '';
}

function safeJsonStringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

const KEY_REGEX = /^[A-Za-z0-9_-]+$/;

function suggestKeyFromLabel(label: string): string {
  const raw = String(label || '').trim().toLowerCase();
  if (!raw) return '';
  const k = raw
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
  return k;
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-xl border bg-white shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="mt-1 text-xs text-slate-600">
              Key-Format:{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">A-Za-z0-9_-</code>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-2 py-1 text-sm hover:bg-slate-50"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

type FieldDraft = {
  label: string;
  key: string;
  type: string;
  required: boolean;
  isActive: boolean;
  placeholder: string;
  helpText: string;
  sortOrder: string;
  configText: string;
};

function makeEmptyDraft(): FieldDraft {
  return {
    label: '',
    key: '',
    type: 'TEXT',
    required: false,
    isActive: true,
    placeholder: '',
    helpText: '',
    sortOrder: '',
    configText: '',
  };
}

type DetailState =
  | { status: 'loading' | 'idle'; form?: Form; fields?: Field[]; raw?: unknown }
  | { status: 'ok'; form: Form; fields: Field[]; raw: unknown }
  | { status: 'error'; message: string; raw?: unknown; form?: Form; fields?: Field[] };

export function FormDetailClient({ formId }: { formId: string }) {
  const [state, setState] = React.useState<DetailState>({ status: 'idle' });

  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');

  const [metaDraft, setMetaDraft] = React.useState<{ name: string; description: string }>({
    name: '',
    description: '',
  });
  const metaSeedRef = React.useRef<string>('');
  const [metaBusy, setMetaBusy] = React.useState(false);
  const [metaError, setMetaError] = React.useState('');
  const [metaOkHint, setMetaOkHint] = React.useState('');

  const [fieldModal, setFieldModal] = React.useState<
    | null
    | { mode: 'create'; draft: FieldDraft; keyTouched: boolean }
    | { mode: 'edit'; field: Field; draft: FieldDraft; keyTouched: boolean }
  >(null);
  const [fieldBusy, setFieldBusy] = React.useState(false);
  const [fieldError, setFieldError] = React.useState('');
  const [sortBusy, setSortBusy] = React.useState(false);
  const [sortError, setSortError] = React.useState('');

  async function load() {
    setState((prev) => ({
      status: 'loading',
      form: 'form' in prev ? prev.form : undefined,
      fields: 'fields' in prev ? prev.fields : undefined,
      raw: 'raw' in prev ? prev.raw : undefined,
    }));

    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}`, {
      method: 'GET',
    });

    if (res.ok) {
      const form = normalizeForm(res.data);
      const fields = normalizeFields(res.data)
        .slice()
        .sort((a, b) => {
          const ao = fieldOrderValue(a);
          const bo = fieldOrderValue(b);
          if (ao !== bo) return ao - bo;
          const ak = String(pickFieldKey(a) || '');
          const bk = String(pickFieldKey(b) || '');
          if (ak !== bk) return ak.localeCompare(bk);
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });

      setState({ status: 'ok', form, fields, raw: res.raw });
      return;
    }

    setState((prev) => ({
      status: 'error',
      message: res.error?.message ?? 'Unbekannter Fehler',
      raw: res.raw,
      form: 'form' in prev ? prev.form : undefined,
      fields: 'fields' in prev ? prev.fields : undefined,
    }));
  }

  async function patchStatus(toStatus: 'DRAFT' | 'ACTIVE' | 'ARCHIVED') {
    setBusy(true);
    setActionError('');

    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: toStatus }),
    });

    if (!res.ok) {
      setBusy(false);
      setActionError(res.error?.message ?? 'Status-Update fehlgeschlagen');
      return;
    }

    await load();
    setBusy(false);
  }

  async function saveMeta() {
    if (state.status !== 'ok') return;

    setMetaBusy(true);
    setMetaError('');
    setMetaOkHint('');

    const name = String(metaDraft.name || '').trim();
    if (!name) {
      setMetaBusy(false);
      setMetaError('Name ist erforderlich.');
      return;
    }

    const descTrimmed = String(metaDraft.description || '').trim();
    const payload: any = {
      name,
      description: descTrimmed ? descTrimmed : null,
    };

    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      setMetaBusy(false);
      setMetaError(res.error?.message ?? 'Speichern fehlgeschlagen');
      return;
    }

    setMetaOkHint('Gespeichert.');
    await load();
    setMetaBusy(false);

    setTimeout(() => setMetaOkHint(''), 1500);
  }

  function openCreateField() {
    setFieldError('');
    const d = makeEmptyDraft();
    setFieldModal({ mode: 'create', draft: d, keyTouched: false });
  }

  function openEditField(field: Field) {
    setFieldError('');
    const sortOrder = field?.sortOrder;
    const d: FieldDraft = {
      label: String(pickFieldLabel(field) || ''),
      key: String(pickFieldKey(field) || ''),
      type: String(pickFieldType(field) || 'TEXT').toUpperCase(),
      required: Boolean(pickFieldRequired(field) ?? false),
      isActive: Boolean(pickFieldActive(field) ?? true),
      placeholder: pickFieldPlaceholder(field),
      helpText: pickFieldHelpText(field),
      sortOrder: typeof sortOrder === 'number' ? String(sortOrder) : '',
      configText: safeJsonStringify(field?.config),
    };
    setFieldModal({ mode: 'edit', field, draft: d, keyTouched: true });
  }

  function closeFieldModal() {
    if (fieldBusy) return;
    setFieldModal(null);
    setFieldError('');
  }

  function validateFieldDraft(d: FieldDraft): string | null {
    const label = String(d.label || '').trim();
    const key = String(d.key || '').trim();
    const type = String(d.type || '').trim().toUpperCase();

    if (!label) return 'Label ist erforderlich.';
    if (!key) return 'Key ist erforderlich.';
    if (!KEY_REGEX.test(key)) return 'Key ist ungültig. Erlaubt: A-Za-z0-9_-';
    if (!type) return 'Type ist erforderlich.';

    const cfg = String(d.configText || '').trim();
    if (cfg) {
      try {
        JSON.parse(cfg);
      } catch {
        return 'Config ist kein gültiges JSON.';
      }
    }

    const so = String(d.sortOrder || '').trim();
    if (so) {
      const n = Number(so);
      if (!Number.isInteger(n) || n < 0) return 'sortOrder muss eine ganze Zahl >= 0 sein.';
    }

    return null;
  }

  function buildFieldPayload(d: FieldDraft) {
    const label = String(d.label || '').trim();
    const key = String(d.key || '').trim();
    const type = String(d.type || '').trim().toUpperCase();

    const placeholderTrim = String(d.placeholder || '').trim();
    const helpTextTrim = String(d.helpText || '').trim();

    const cfgText = String(d.configText || '').trim();
    const config = cfgText ? JSON.parse(cfgText) : undefined;

    const soText = String(d.sortOrder || '').trim();
    const sortOrder = soText ? Number(soText) : undefined;

    const payload: any = {
      label,
      key,
      type,
      required: Boolean(d.required),
      isActive: Boolean(d.isActive),
      placeholder: placeholderTrim ? placeholderTrim : null,
      helpText: helpTextTrim ? helpTextTrim : null,
    };

    if (config !== undefined) payload.config = config;
    if (sortOrder !== undefined) payload.sortOrder = sortOrder;

    return payload;
  }

  async function submitFieldModal() {
    if (!fieldModal) return;
    if (state.status !== 'ok') return;

    setFieldError('');
    const err = validateFieldDraft(fieldModal.draft);
    if (err) {
      setFieldError(err);
      return;
    }

    setFieldBusy(true);

    if (fieldModal.mode === 'create') {
      const payload = buildFieldPayload(fieldModal.draft);

      const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}/fields`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setFieldBusy(false);
        setFieldError(res.error?.message ?? 'Field erstellen fehlgeschlagen');
        return;
      }

      await load();
      setFieldBusy(false);
      setFieldModal(null);
      return;
    }

    const payload = buildFieldPayload(fieldModal.draft);
    const fieldId = String(fieldModal.field?.id || '').trim();
    if (!fieldId) {
      setFieldBusy(false);
      setFieldError('fieldId fehlt (DEV Fehler).');
      return;
    }

    const res = await adminFetch<any>(
      `/api/admin/v1/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      setFieldBusy(false);
      setFieldError(res.error?.message ?? 'Field speichern fehlgeschlagen');
      return;
    }

    await load();
    setFieldBusy(false);
    setFieldModal(null);
  }

  async function deleteField(field: Field) {
    if (state.status !== 'ok') return;

    const fieldId = String(field?.id || '').trim();
    if (!fieldId) return;

    const label = pickFieldLabel(field);
    if (!confirm(`Field wirklich löschen?\n\n${label}`)) return;

    setFieldError('');
    setFieldBusy(true);

    const res = await adminFetch<any>(
      `/api/admin/v1/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`,
      { method: 'DELETE' }
    );

    if (!res.ok) {
      setFieldBusy(false);
      setFieldError(res.error?.message ?? 'Löschen fehlgeschlagen');
      return;
    }

    await load();
    setFieldBusy(false);
  }

  async function persistOrder(newOrder: Field[]) {
    if (state.status !== 'ok') return;

    setSortBusy(true);
    setSortError('');

    const currentById = new Map<string, number>();
    for (const f of state.fields) {
      const id = String(f?.id ?? '');
      if (id) currentById.set(id, typeof f?.sortOrder === 'number' ? f.sortOrder : fieldOrderValue(f));
    }

    for (let i = 0; i < newOrder.length; i++) {
      const f = newOrder[i];
      const id = String(f?.id ?? '');
      if (!id) continue;

      const desired = i;
      const current = currentById.get(id);

      if (current === desired) continue;

      const res = await adminFetch<any>(
        `/api/admin/v1/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sortOrder: desired }),
        }
      );

      if (!res.ok) {
        setSortBusy(false);
        setSortError(res.error?.message ?? 'Sortierung speichern fehlgeschlagen');
        await load();
        return;
      }
    }

    await load();
    setSortBusy(false);
  }

  async function moveField(fieldId: string, dir: 'up' | 'down') {
    if (state.status !== 'ok') return;

    const cur = state.fields.slice();
    const idx = cur.findIndex((f) => String(f?.id ?? '') === fieldId);
    if (idx < 0) return;

    const swapWith = dir === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= cur.length) return;

    const next = cur.slice();
    const tmp = next[idx];
    next[idx] = next[swapWith];
    next[swapWith] = tmp;

    await persistOrder(next);
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  React.useEffect(() => {
    if (state.status !== 'ok') return;

    const seed = `${String(state.form?.id ?? '')}:${String(state.form?.updatedAt ?? '')}`;
    if (metaSeedRef.current === seed) return;

    metaSeedRef.current = seed;
    setMetaDraft({
      name: String(state.form?.name ?? ''),
      description: pickDescription(state.form),
    });
    setMetaError('');
    setMetaOkHint('');
  }, [state]);

  const currentStatus = state.status === 'ok' ? pickStatus(state.form) : 'UNKNOWN';
  const primary = nextPrimaryAction(currentStatus);

  const metaDirty =
    state.status === 'ok' &&
    (String(metaDraft.name ?? '') !== String(state.form?.name ?? '') ||
      String(metaDraft.description ?? '') !== pickDescription(state.form));

  return (
    <div className="space-y-6">
      {/* Overview / Status */}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {state.status === 'ok' ? pickName(state.form) : 'Form'}
            </h2>
            <p className="text-sm text-slate-600">
              GET{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">
                /api/admin/v1/forms/{formId}
              </code>
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4">
          {state.status === 'loading' || state.status === 'idle' ? (
            <div className="text-sm text-slate-600">Lade…</div>
          ) : state.status === 'error' ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="font-medium">Fehler</div>
              <div className="mt-1">{state.message}</div>

              <div className="mt-3 text-xs text-red-900/80">
                DEV-Tipp: Setze oben im Header eine gültige{' '}
                <code className="rounded bg-red-100 px-1 py-0.5">x-user-id</code> und lade neu.
              </div>

              {state.raw ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs">Raw response</summary>
                  <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs text-slate-800">
                    {JSON.stringify(state.raw, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-slate-600">Status</div>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusBadge status={currentStatus} />
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      {primary ? (
                        <button
                          type="button"
                          onClick={() => void patchStatus(primary.toStatus)}
                          disabled={busy || metaBusy || fieldBusy || sortBusy}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          title={`Setzt Status auf ${primary.toStatus}`}
                        >
                          {busy ? 'Speichern…' : primary.label}
                        </button>
                      ) : null}

                      {String(currentStatus).toUpperCase() !== 'ARCHIVED' ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirm('Form wirklich archivieren?')) return;
                            void patchStatus('ARCHIVED');
                          }}
                          disabled={busy || metaBusy || fieldBusy || sortBusy}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Archiviert das Form"
                        >
                          {busy ? '…' : 'Archivieren'}
                        </button>
                      ) : null}
                    </div>

                    {actionError ? (
                      <div className="max-w-[520px] text-right text-xs text-red-700">
                        {actionError}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-600">Meta</div>
                <div className="mt-2 space-y-1 text-sm text-slate-800">
                  <div>
                    <span className="text-slate-500">ID:</span>{' '}
                    <span className="font-mono text-xs">{state.form?.id ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Updated:</span>{' '}
                    <span className="font-mono text-xs">{state.form?.updatedAt ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Created:</span>{' '}
                    <span className="font-mono text-xs">{state.form?.createdAt ?? '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Form bearbeiten */}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Form bearbeiten</h3>
            <p className="text-sm text-slate-600">Name &amp; Beschreibung speichern (PATCH).</p>
          </div>

          <button
            type="button"
            onClick={() => void saveMeta()}
            disabled={state.status !== 'ok' || metaBusy || !metaDirty}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {metaBusy ? 'Speichern…' : 'Save'}
          </button>
        </div>

        {state.status !== 'ok' ? (
          <div className="mt-4 text-sm text-slate-600">—</div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Name *</label>
              <input
                value={metaDraft.name}
                onChange={(e) => setMetaDraft((s) => ({ ...s, name: e.target.value }))}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="z.B. Messe Leads 2026"
              />
              <div className="mt-1 text-xs text-slate-500">
                Wird als Form-Name in Admin &amp; Mobile genutzt.
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Beschreibung</label>
              <textarea
                value={metaDraft.description}
                onChange={(e) => setMetaDraft((s) => ({ ...s, description: e.target.value }))}
                className="mt-1 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Optional…"
                rows={3}
              />
              <div className="mt-1 text-xs text-slate-500">Optional. Leer =&gt; null.</div>
            </div>
          </div>
        )}

        {metaError ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {metaError}
          </div>
        ) : null}

        {metaOkHint ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {metaOkHint}
          </div>
        ) : null}
      </section>

      {/* Fields */}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Felder</h3>
            <p className="text-sm text-slate-600">
              CRUD via{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">
                /api/admin/v1/forms/{formId}/fields
              </code>
              . Sort per Up/Down (PATCH sortOrder).
            </p>
          </div>

          <div className="flex items-center gap-2">
            {state.status === 'ok' ? (
              <div className="text-sm text-slate-700">
                Count: <span className="font-medium">{state.fields.length}</span>
              </div>
            ) : null}

            <button
              type="button"
              onClick={openCreateField}
              disabled={state.status !== 'ok' || fieldBusy || sortBusy}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              + Feld hinzufügen
            </button>
          </div>
        </div>

        <div className="mt-4">
          {state.status !== 'ok' ? (
            <div className="text-sm text-slate-600">—</div>
          ) : state.fields.length === 0 ? (
            <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
              Keine Felder vorhanden.
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Key</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Req</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2">sortOrder</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.fields.map((fld, idx) => {
                    const req = pickFieldRequired(fld);
                    const act = pickFieldActive(fld);
                    const id = String(fld?.id ?? '');
                    const so = typeof fld?.sortOrder === 'number' ? fld.sortOrder : fieldOrderValue(fld);

                    return (
                      <tr key={id || idx} className="border-t">
                        <td className="px-3 py-2 text-slate-700">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">{pickFieldLabel(fld)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">
                          {pickFieldKey(fld) || '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{pickFieldType(fld) || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{req === null ? '—' : req ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-slate-700">{act === null ? '—' : act ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{so}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => void moveField(id, 'up')}
                              disabled={sortBusy || fieldBusy || idx === 0}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              title="Nach oben"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => void moveField(id, 'down')}
                              disabled={sortBusy || fieldBusy || idx === state.fields.length - 1}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                              title="Nach unten"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditField(fld)}
                              disabled={fieldBusy || sortBusy}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteField(fld)}
                              disabled={fieldBusy || sortBusy}
                              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {sortBusy ? <div className="mt-3 text-sm text-slate-600">Sortiere…</div> : null}

          {sortError ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {sortError}
            </div>
          ) : null}

          {fieldError ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {fieldError}
            </div>
          ) : null}

          {state.status === 'ok' ? (
            <details className="mt-4 rounded-lg border bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">
                Debug: Raw JSON
              </summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-900">
                {JSON.stringify(state.raw, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </section>

      {/* Field Modal */}
      {fieldModal ? (
        <ModalShell
          title={fieldModal.mode === 'create' ? 'Feld hinzufügen' : 'Feld bearbeiten'}
          onClose={closeFieldModal}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Label *</label>
              <input
                value={fieldModal.draft.label}
                onChange={(e) => {
                  const label = e.target.value;
                  setFieldModal((s) => {
                    if (!s) return s;
                    const nextDraft = { ...s.draft, label };
                    if (!s.keyTouched) {
                      const suggested = suggestKeyFromLabel(label);
                      nextDraft.key = suggested || nextDraft.key;
                    }
                    return { ...s, draft: nextDraft };
                  });
                }}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="z.B. Vorname"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Key *</label>
              <input
                value={fieldModal.draft.key}
                onChange={(e) => {
                  const key = e.target.value;
                  setFieldModal((s) =>
                    s ? { ...s, keyTouched: true, draft: { ...s.draft, key } } : s
                  );
                }}
                className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="z.B. firstname"
              />
              <div className="mt-1 text-xs text-slate-500">
                Muss eindeutig sein pro Form (409 KEY_CONFLICT).
              </div>
              {fieldModal.draft.key && !KEY_REGEX.test(fieldModal.draft.key.trim()) ? (
                <div className="mt-1 text-xs text-red-700">Ungültiger Key.</div>
              ) : null}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Type *</label>
              <select
                value={String(fieldModal.draft.type || 'TEXT').toUpperCase()}
                onChange={(e) =>
                  setFieldModal((s) =>
                    s ? { ...s, draft: { ...s.draft, type: e.target.value } } : s
                  )
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="TEXT">TEXT</option>
                <option value="TEXTAREA">TEXTAREA</option>
                <option value="EMAIL">EMAIL</option>
                <option value="PHONE">PHONE</option>
                <option value="NUMBER">NUMBER</option>
                <option value="SELECT">SELECT</option>
                <option value="MULTISELECT">MULTISELECT</option>
                <option value="CHECKBOX">CHECKBOX</option>
                <option value="DATE">DATE</option>
                <option value="DATETIME">DATETIME</option>
                <option value="URL">URL</option>
              </select>
            </div>

            <div className="flex items-center gap-6 pt-6">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={fieldModal.draft.required}
                  onChange={(e) =>
                    setFieldModal((s) =>
                      s ? { ...s, draft: { ...s.draft, required: e.target.checked } } : s
                    )
                  }
                />
                Required
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={fieldModal.draft.isActive}
                  onChange={(e) =>
                    setFieldModal((s) =>
                      s ? { ...s, draft: { ...s.draft, isActive: e.target.checked } } : s
                    )
                  }
                />
                Active
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Placeholder</label>
              <input
                value={fieldModal.draft.placeholder}
                onChange={(e) =>
                  setFieldModal((s) =>
                    s ? { ...s, draft: { ...s.draft, placeholder: e.target.value } } : s
                  )
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Optional…"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">HelpText</label>
              <input
                value={fieldModal.draft.helpText}
                onChange={(e) =>
                  setFieldModal((s) =>
                    s ? { ...s, draft: { ...s.draft, helpText: e.target.value } } : s
                  )
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Optional…"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Config (JSON, optional)</label>
              <textarea
                value={fieldModal.draft.configText}
                onChange={(e) =>
                  setFieldModal((s) =>
                    s ? { ...s, draft: { ...s.draft, configText: e.target.value } } : s
                  )
                }
                className="mt-1 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-slate-200"
                rows={6}
                placeholder='z.B. {"options":[...]}'
              />
              <div className="mt-1 text-xs text-slate-500">Wird als JSON geparsed. Leer =&gt; nicht gesendet.</div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">sortOrder (optional)</label>
              <input
                value={fieldModal.draft.sortOrder}
                onChange={(e) =>
                  setFieldModal((s) =>
                    s ? { ...s, draft: { ...s.draft, sortOrder: e.target.value } } : s
                  )
                }
                className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="z.B. 0"
              />
              <div className="mt-1 text-xs text-slate-500">Normalerweise via ↑/↓. Muss Integer ≥ 0 sein.</div>
            </div>

            <div className="md:col-span-2">
              {fieldError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {fieldError}
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeFieldModal}
                disabled={fieldBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitFieldModal()}
                disabled={fieldBusy}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {fieldBusy ? 'Speichern…' : 'Save'}
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
