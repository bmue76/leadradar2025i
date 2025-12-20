'use client';

import * as React from 'react';
import { adminFetch } from '../../_lib/adminFetch';

type Template = any;

function pickLabel(t: Template): string {
  return (
    t?.name ??
    t?.title ??
    t?.label ??
    t?.displayName ??
    t?.slug ??
    'Template'
  );
}

function pickCategory(t: Template): string {
  return t?.category ?? t?.type ?? t?.group ?? '';
}

function pickUpdated(t: Template): string {
  return (
    t?.updatedAt ??
    t?.createdAt ??
    t?.meta?.updatedAt ??
    t?.meta?.createdAt ??
    ''
  );
}

function normalizeItems(rawData: any): Template[] {
  // Accept common shapes:
  // - { items: [...] }
  // - { data: { items: [...] } } (adminFetch already unwraps .data, but still handle)
  // - [ ... ]
  const d = rawData;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(d?.templates)) return d.templates;
  if (Array.isArray(d?.data?.items)) return d.data.items;
  return [];
}

export function TemplatesListClient() {
  const [state, setState] = React.useState<
    | { status: 'loading' | 'idle' }
    | { status: 'ok'; items: Template[]; raw: unknown }
    | { status: 'error'; message: string; raw?: unknown }
  >({ status: 'idle' });

  async function load() {
    setState({ status: 'loading' });

    const res = await adminFetch<any>('/api/admin/v1/templates', { method: 'GET' });

    if (res.ok) {
      const items = normalizeItems(res.data);
      setState({ status: 'ok', items, raw: res.raw });
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
          <h2 className="text-lg font-semibold">Templates Liste</h2>
          <p className="text-sm text-slate-600">
            GET <code className="rounded bg-slate-100 px-1 py-0.5">/api/admin/v1/templates</code>
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
              </div>
              <div className="text-xs text-slate-500">DEV/MVP Ansicht</div>
            </div>

            <div className="overflow-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Kategorie</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {state.items.map((t, idx) => (
                    <tr key={t?.id ?? idx} className="border-t">
                      <td className="px-3 py-2 font-medium text-slate-900">{pickLabel(t)}</td>
                      <td className="px-3 py-2 text-slate-700">{pickCategory(t) || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{pickUpdated(t) || '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">{t?.id ?? '—'}</td>
                    </tr>
                  ))}
                  {state.items.length === 0 ? (
                    <tr className="border-t">
                      <td className="px-3 py-3 text-slate-600" colSpan={4}>
                        Keine Templates gefunden. (Wenn du Seed erwartest: checke DB/Seed & Admin API.)
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
