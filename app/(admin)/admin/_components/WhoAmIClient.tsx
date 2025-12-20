'use client';

import * as React from 'react';
import { adminFetch } from '../_lib/adminFetch';

type WhoAmIData = any;

export function WhoAmIClient() {
  const [state, setState] = React.useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ok'; data: WhoAmIData }
    | { status: 'error'; message: string; raw?: unknown }
  >({ status: 'idle' });

  async function load() {
    setState({ status: 'loading' });

    const res = await adminFetch<WhoAmIData>('/api/admin/v1/whoami', {
      method: 'GET',
    });

    if (res.ok) {
      setState({ status: 'ok', data: res.data });
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
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">whoami</h2>
          <p className="text-sm text-slate-600">
            GET <code className="rounded bg-slate-100 px-1 py-0.5">/api/admin/v1/whoami</code>
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
              (Owner/Member cuid). Danach Refresh.
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
            <div className="rounded-lg border bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-600">Response (data)</div>
              <pre className="mt-2 overflow-auto text-xs text-slate-900">
                {JSON.stringify(state.data, null, 2)}
              </pre>
            </div>

            <p className="text-xs text-slate-500">
              Hinweis: In 2.0 zeigen wir Status/Struktur minimal. In 2.1 kommen Interaktionen (z.B. Status-Toggle).
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
