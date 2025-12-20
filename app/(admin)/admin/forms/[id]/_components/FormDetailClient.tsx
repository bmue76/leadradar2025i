'use client';

import * as React from 'react';
import { adminFetch } from '../../../_lib/adminFetch';

type Form = any;
type Field = any;

function pickName(f: Form): string {
  return f?.name ?? f?.title ?? f?.label ?? f?.slug ?? 'Form';
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
  // Accept common shapes:
  // - { form: {...}, fields: [...] }
  // - { ...form, fields: [...] }
  // - { item: {...} }
  const d = rawData;
  if (d?.form) return d.form;
  if (d?.item) return d.item;
  return d;
}

function normalizeFields(rawData: any): Field[] {
  const d = rawData;

  // Most likely:
  // - { form: {...}, fields: [...] }
  // - { fields: [...] }
  // - { ...form, fields: [...] }
  if (Array.isArray(d?.fields)) return d.fields;
  if (Array.isArray(d?.form?.fields)) return d.form.fields;
  if (Array.isArray(d?.items)) return d.items;

  // Sometimes fields might be nested
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

export function FormDetailClient({ formId }: { formId: string }) {
  const [state, setState] = React.useState<
    | { status: 'loading' | 'idle' }
    | { status: 'ok'; form: Form; fields: Field[]; raw: unknown }
    | { status: 'error'; message: string; raw?: unknown }
  >({ status: 'idle' });

  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');

  async function load() {
    setState({ status: 'loading' });

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
          // stable tie-breakers
          const ak = String(pickFieldKey(a) || '');
          const bk = String(pickFieldKey(b) || '');
          if (ak !== bk) return ak.localeCompare(bk);
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });

      setState({ status: 'ok', form, fields, raw: res.raw });
      return;
    }

    setState({
      status: 'error',
      message: res.error?.message ?? 'Unbekannter Fehler',
      raw: res.raw,
    });
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

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  const currentStatus = state.status === 'ok' ? pickStatus(state.form) : 'UNKNOWN';
  const primary = nextPrimaryAction(currentStatus);

  return (
    <div className="space-y-6">
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
                          disabled={busy}
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
                          disabled={busy}
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

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Fields</h3>
            <p className="text-sm text-slate-600">Sortiert nach sortOrder/order (Fallback stabil).</p>
          </div>

          {state.status === 'ok' ? (
            <div className="text-sm text-slate-700">
              Count: <span className="font-medium">{state.fields.length}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4">
          {state.status !== 'ok' ? (
            <div className="text-sm text-slate-600">—</div>
          ) : state.fields.length === 0 ? (
            <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
              Keine Fields vorhanden.
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
                    <th className="px-3 py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {state.fields.map((fld, idx) => {
                    const req = pickFieldRequired(fld);
                    const act = pickFieldActive(fld);
                    return (
                      <tr key={fld?.id ?? idx} className="border-t">
                        <td className="px-3 py-2 text-slate-700">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">{pickFieldLabel(fld)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{pickFieldKey(fld) || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{pickFieldType(fld) || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{req === null ? '—' : req ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-slate-700">{act === null ? '—' : act ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{fld?.id ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
    </div>
  );
}
