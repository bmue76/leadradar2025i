// app/api/mobile/v1/health/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getTraceId(req: NextRequest) {
  const incoming = req.headers.get("x-trace-id")?.trim();
  return incoming && incoming.length <= 128 ? incoming : cryptoRandom();
}

function cryptoRandom() {
  // Node.js runtime → crypto.randomUUID ist verfügbar
  // Fallback: Timestamp + random
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto as any;
  if (c?.randomUUID) return c.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function jsonOk(traceId: string, data: unknown, status = 200) {
  const res = NextResponse.json({ ok: true, data, traceId }, { status });
  res.headers.set("x-trace-id", traceId);
  return res;
}

export async function GET(req: NextRequest) {
  const traceId = getTraceId(req);
  return jsonOk(traceId, {
    status: "ok",
    now: new Date().toISOString(),
  });
}

export async function HEAD(req: NextRequest) {
  const traceId = getTraceId(req);
  const res = new NextResponse(null, { status: 200 });
  res.headers.set("x-trace-id", traceId);
  return res;
}
