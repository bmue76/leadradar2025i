type MobileRequest = {
  baseUrl: string;
  tenantSlug: string;
  path: string; // must start with /
  timeoutMs?: number;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function parseJsonSafe(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function mobileGetJson<T = any>(req: MobileRequest): Promise<T> {
  const base = normalizeBaseUrl(req.baseUrl);
  const url = `${base}${req.path}`;
  const timeoutMs = typeof req.timeoutMs === "number" ? req.timeoutMs : 2500;

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-tenant-slug": req.tenantSlug,
      },
    },
    timeoutMs
  );

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.code)) ||
      `HTTP ${res.status} on GET ${req.path}`;
    throw new Error(String(msg));
  }

  return data as T;
}

export async function mobilePostJson<T = any>(req: MobileRequest & { body: any }): Promise<T> {
  const base = normalizeBaseUrl(req.baseUrl);
  const url = `${base}${req.path}`;
  const timeoutMs = typeof req.timeoutMs === "number" ? req.timeoutMs : 6000;

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-tenant-slug": req.tenantSlug,
      },
      body: JSON.stringify(req.body ?? {}),
    },
    timeoutMs
  );

  const data = await parseJsonSafe(res);

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error || data.code)) ||
      `HTTP ${res.status} on POST ${req.path}`;
    throw new Error(String(msg));
  }

  return data as T;
}
