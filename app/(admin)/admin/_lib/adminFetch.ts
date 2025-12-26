'use client';

import { getDevUserId } from '../_components/DevUserIdBar';

export type ApiErrorShape = {
  message?: string;
  code?: string;
  details?: unknown;
};

export type ApiResult<T> =
  | { ok: true; status: number; data: T; raw: unknown }
  | { ok: false; status: number; error: ApiErrorShape; raw: unknown };

function safeJsonParse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * DEV Admin fetch:
 * - Reads x-user-id from localStorage (via DevUserIdBar helper)
 * - Adds it to request headers for admin APIs
 * - Normalizes API responses & errors to a consistent shape
 */
export async function adminFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers ?? {});
  headers.set('accept', 'application/json');

  const devUserId = getDevUserId();
  if (devUserId) headers.set('x-user-id', devUserId);

  const res = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text();
  const json = safeJsonParse(text);

  if (res.ok) {
    // Our APIs typically respond with { ok:true, data: ... }.
    // But if a route returns a raw object, we still accept it.
    const data = (json as any)?.data ?? (json as any);
    return { ok: true, status: res.status, data: data as T, raw: json };
  }

  const message =
    (json as any)?.error?.message ??
    (json as any)?.message ??
    `HTTP ${res.status}`;

  const error: ApiErrorShape = {
    ...(json as any)?.error,
    message,
  };

  return { ok: false, status: res.status, error, raw: json };
}

export default adminFetch;
