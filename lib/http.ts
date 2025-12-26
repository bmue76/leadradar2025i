import { ZodError, ZodTypeAny } from "zod";

export type QueryRecord = Record<string, string | string[]>;

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "HttpError" &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

export function httpError(
  status: number,
  code: string,
  message: string,
  details?: unknown
): HttpError {
  return new HttpError(status, code, message, details);
}

/**
 * Safe JSON parsing (consumes body once).
 * - empty body -> returns undefined
 * - invalid JSON -> throws HttpError(400, "BAD_JSON", ...)
 * - too large -> throws HttpError(413, "BODY_TOO_LARGE", ...)
 */
export async function parseJson(
  req: Request,
  opts?: { maxBytes?: number }
): Promise<unknown | undefined> {
  const maxBytes = opts?.maxBytes ?? 512 * 1024; // 512KB default
  const raw = await req.text();

  if (!raw || raw.trim().length === 0) return undefined;

  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > maxBytes) {
    throw httpError(413, "BODY_TOO_LARGE", "Request body too large.", {
      maxBytes,
      bytes,
    });
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "BAD_JSON", "Invalid JSON body.");
  }
}

/**
 * Parses req.url (or a url string) into:
 * - url: URL
 * - query: Record<string, string | string[]>
 */
export function parseQuery(input: Request | string): { url: URL; query: QueryRecord } {
  const url = typeof input === "string" ? new URL(input) : new URL(input.url);

  const query: QueryRecord = {};
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    if (all.length <= 1) query[key] = all[0] ?? "";
    else query[key] = all;
  }

  return { url, query };
}

function zodDetails(err: ZodError) {
  return {
    issues: err.issues.map((i) => ({
      path: i.path,
      message: i.message,
      code: i.code,
    })),
  };
}

/**
 * Validates JSON body with Zod and returns typed output.
 * Throws HttpError(400, "INVALID_BODY", ...) on validation errors.
 */
export async function validateBody<TSchema extends ZodTypeAny>(
  req: Request,
  schema: TSchema,
  opts?: { maxBytes?: number }
): Promise<ReturnType<TSchema["parse"]>> {
  const data = await parseJson(req, { maxBytes: opts?.maxBytes });
  const res = schema.safeParse(data);

  if (!res.success) {
    throw httpError(400, "INVALID_BODY", "Request body validation failed.", zodDetails(res.error));
  }

  return res.data;
}

/**
 * Validates query params with Zod and returns typed output.
 * Throws HttpError(400, "INVALID_QUERY", ...) on validation errors.
 */
export function validateQuery<TSchema extends ZodTypeAny>(
  input: Request | string,
  schema: TSchema
): ReturnType<TSchema["parse"]> {
  const { query } = parseQuery(input);
  const res = schema.safeParse(query);

  if (!res.success) {
    throw httpError(400, "INVALID_QUERY", "Query validation failed.", zodDetails(res.error));
  }

  return res.data;
}
