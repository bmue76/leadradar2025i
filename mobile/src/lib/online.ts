// mobile/src/lib/online.ts
export type OnlineProbeResult = {
  reachable: boolean; // true wenn fetch überhaupt eine HTTP response liefert
  ok: boolean; // true wenn response.ok
  status?: number;
  latencyMs?: number;
  error?: string;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

export async function probeBackendOnline(params: {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<OnlineProbeResult> {
  const { baseUrl, headers = {}, timeoutMs = 2500 } = params;

  const url = `${normalizeBaseUrl(baseUrl)}/api/mobile/v1/health`;
  const controller = new AbortController();
  const started = Date.now();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "cache-control": "no-store",
        ...headers,
      },
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;

    // Reachable = wir haben eine Response erhalten (auch wenn 500)
    return {
      reachable: true,
      ok: res.ok,
      status: res.status,
      latencyMs,
    };
  } catch (e: any) {
    const isTimeout = e?.name === "AbortError";
    return {
      reachable: false,
      ok: false,
      error: isTimeout ? "timeout" : String(e?.message ?? e),
    };
  } finally {
    clearTimeout(t);
  }
}
