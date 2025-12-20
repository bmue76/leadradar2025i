'use client';

import * as React from 'react';

const STORAGE_KEY = 'LR_DEV_USER_ID';

export function DevUserIdBar() {
  const [value, setValue] = React.useState('');
  const [saved, setSaved] = React.useState<string>('');

  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY) ?? '';
      setValue(v);
      setSaved(v);
    } catch {
      // ignore
    }
  }, []);

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, value.trim());
      setSaved(value.trim());
    } catch {
      // ignore
    }
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      setValue('');
      setSaved('');
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-white px-2 py-1">
      <span className="hidden text-xs text-slate-500 sm:inline">DEV x-user-id</span>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="cuid…"
        className="w-[210px] rounded-md border px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-slate-200"
      />

      <button
        type="button"
        onClick={save}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
        title="Speichert in localStorage (DEV)"
      >
        Setzen
      </button>

      <button
        type="button"
        onClick={clear}
        className="rounded-md border px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        title="Löscht aus localStorage (DEV)"
      >
        Clear
      </button>

      <span className="hidden text-xs text-slate-500 md:inline">
        {saved ? `= ${saved}` : '(leer)'}
      </span>
    </div>
  );
}

export function getDevUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && v.trim().length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}
