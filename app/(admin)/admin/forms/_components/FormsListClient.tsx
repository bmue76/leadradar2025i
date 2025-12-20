'use client';

import * as React from 'react';
import Link from 'next/link';
import { adminFetch } from '../../_lib/adminFetch';

type Form = any;

function normalizeItems(rawData: any): { items: Form[]; paging?: any } {
  const d = rawData;
  if (Array.isArray(d)) return { items: d };
  if (Array.isArray(d?.items)) return { items: d.items, paging: d.paging };
  if (Array.isArray(d?.forms)) return { items: d.forms, paging: d.paging };
  if (Array.isArray(d?.data?.items)) return { items: d.data.items, paging: d.data.paging };
  return { items: [] };
}

function pickName(f: Form): string {
  return f?.name ?? f?.title ?? f?.label ?? f?.slug ?? 'Form';
}

function pickStatus(f: Form): string {
  return (f?.status ?? f?.formStatus ?? 'UNKNOWN') as string;
}

function pickUpdated(f: Form): string {
  return f?.updatedAt ?? f?.createdAt ?? '';
}

function pickFieldsCount(f: Form): string {
  const v =
    f?.fieldsCount ??
    f?.fieldCount ??
    (Array.isArray(f?.fields) ? f.fields.length : undefined);
  return typeof v === 'number' ? String(v) : '—';
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || 'UNKNOWN').toUpperCase();

  // Neutral defaults (we avoid domain assumptions; 2.1 will make this interactive)
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

export function FormsListClient() {
  const [state, setState] = React.useState<
    | { status: 'loading' | 'idle' }
    | { status: 'ok'; items: Form[]; paging?: any; raw: unknown }
    | { status: 'error'; message: string; raw?: unknown }
  >({ status: 'idle' });

  async function load() {
    setState({ status: 'loading' });

    const res = await adminFetch<any>('/api/admin/v1/forms', { method: 'GET' });

    if (res.ok) {
      const { items, paging } = normalizeItems(res.data);
      setState({ status: 'ok', items, paging, raw: res.raw });
      return;
    }

    setState({
      status: 'error',
      message: res.error?.message ?? 'Unbekannter Fehler',
      raw: res.raw,
    });
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Forms Liste</h2>
          <p className="text-sm text-slate-600">
            GET <code className="rounded bg-slate-100 px-1 py-0.5">/api/admin/v1/forms</code>
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
              DEV-Tipp: Setze oben im Header eine gültige <code className="rounded bg-red-100 px-1 py-0.5">x-user-id</code>{' '}
              und lade neu.
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
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-700">
                Gefunden: <span className="font-medium">{state.items.length}</span>
                {state.paging ? (
                  <span className="ml-2 text-xs text-slate-500">
                    (Paging vorhanden)
                  </span>
                ) : null}
              </div>

              <div className="text-xs text-slate-500">
                Status sichtbar (Action folgt in 2.1)
              </div>
            </div>

            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Fields</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2 text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((f, idx) => (
                    <tr key={f?.id ?? idx} className="border-t">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {pickName(f)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={pickStatus(f)} />
                      </td>
                      <td className="px-3 py-2 text-slate-700">{pickFieldsCount(f)}</td>
                      <td className="px-3 py-2 text-slate-700">{pickUpdated(f) || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{f?.id ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        {f?.id ? (
                          <Link
                            href={`/admin/forms/${f.id}`}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                          >
                            Öffnen
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {state.items.length === 0 ? (
                    <tr className="border-t">
                      <td className="px-3 py-3 text-slate-600" colSpan={6}>
                        Keine Forms gefunden.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <details className="rounded-lg border bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">
                Debug: Raw JSON
              </summary>
              <pre className="mt-3 overflow-auto text-xs text-slate-900">
                {JSON.stringify(state.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
