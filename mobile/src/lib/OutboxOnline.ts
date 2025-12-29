// mobile/src/lib/OutboxOnline.ts
import { probeBackendOnline, OnlineProbeResult } from "./online";

export type OnlineState = {
  online: boolean; // == reachable
  probe: OnlineProbeResult | null;
  checkedAt: number | null;
};

export async function computeOnlineState(params: {
  baseUrl: string;
  tenantSlug: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}): Promise<OnlineState> {
  const { baseUrl, tenantSlug, extraHeaders = {}, timeoutMs } = params;

  const probe = await probeBackendOnline({
    baseUrl,
    timeoutMs,
    headers: {
      "x-tenant-slug": tenantSlug,
      ...extraHeaders,
    },
  });

  return {
    online: probe.reachable,
    probe,
    checkedAt: Date.now(),
  };
}
