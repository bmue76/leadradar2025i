import { NextResponse } from "next/server";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  traceId: string;
};

export type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  traceId: string;
};

function fallbackId(): string {
  const t = Date.now().toString(16);
  const r1 = Math.random().toString(16).slice(2, 10);
  const r2 = Math.random().toString(16).slice(2, 10);
  return `${t}-${r1}-${r2}`;
}

function makeTraceId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return fallbackId();
}

export function getTraceId(req: Request): string {
  const fromClient =
    req.headers.get("x-trace-id") ||
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id");

  return fromClient?.trim() || makeTraceId();
}

function withTraceHeader(initHeaders: HeadersInit | undefined, traceId: string) {
  const h = new Headers(initHeaders);
  h.set("x-trace-id", traceId);
  return h;
}

export function jsonOk<T>(
  req: Request,
  data: T,
  init: ResponseInit = {}
): NextResponse<ApiSuccess<T>> {
  const traceId = getTraceId(req);
  const headers = withTraceHeader(init.headers, traceId);
  return NextResponse.json({ ok: true, data, traceId }, { ...init, headers });
}

export function jsonError(
  req: Request,
  status: number,
  code: string,
  message: string,
  details?: unknown,
  init: ResponseInit = {}
): NextResponse<ApiErrorBody> {
  const traceId = getTraceId(req);
  const headers = withTraceHeader(init.headers, traceId);

  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details === undefined ? {} : { details }) },
      traceId,
    },
    { ...init, status, headers }
  );
}
