// mobile/src/sync/outboxSync.ts
import { DeviceEventEmitter } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { mobilePostJson } from "../lib/mobileApi";
import { DEMO_FORM_ID } from "../lib/demoForms";
import {
  loadOutbox,
  removeOutboxItem,
  updateOutboxItem,
  type OutboxError,
  type OutboxItem,
  type OutboxItemStatus,
  type PendingAttachment,
} from "../storage/outbox";

export const OUTBOX_SYNC_STATUS_EVENT = "leadradar:outboxSyncStatus";

export type OutboxSyncStatus = {
  syncing: boolean;
  reason?: string;
  startedAt?: string;
  finishedAt?: string;

  ok?: number;
  failed?: number;
  skipped?: number;

  skippedReason?: "busy" | "settings" | "empty" | "offline";
  error?: string;
};

export type OutboxSyncSummary = {
  ok: number;
  failed: number;
  skipped: number;
  message: string;
  finishedAt: string;
};

let __syncMutex = false;

function emitStatus(payload: OutboxSyncStatus) {
  DeviceEventEmitter.emit(OUTBOX_SYNC_STATUS_EVENT, payload);
}

function nowIso() {
  return new Date().toISOString();
}

function isDemoLead(item: OutboxItem) {
  return item.formId === DEMO_FORM_ID || item.formId.startsWith("demo-");
}

function stripDataPrefix(b64: string): string {
  const s = String(b64 || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) {
    const idx = s.indexOf(",");
    if (idx >= 0) return s.slice(idx + 1);
  }
  return s;
}

function getServerCode(e: any): string | undefined {
  // If mobileApi throws parsed jsonError: { ok:false, error:{code,message,details}, traceId }
  if (e && typeof e === "object" && e.ok === false && e.error && typeof e.error === "object") {
    if (typeof e.error.code === "string") return e.error.code;
  }
  // Some libs wrap as e.data / e.body
  if (e?.data?.error?.code && typeof e.data.error.code === "string") return e.data.error.code;
  if (e?.body?.error?.code && typeof e.body.error.code === "string") return e.body.error.code;
  return undefined;
}

function getServerMessage(e: any): string | undefined {
  if (e && typeof e === "object" && e.ok === false && e.error && typeof e.error === "object") {
    if (typeof e.error.message === "string") return e.error.message;
  }
  if (typeof e?.message === "string") return e.message;
  return undefined;
}

function toOutboxError(e: any, fallbackMessage: string, code?: string): OutboxError {
  const serverCode = getServerCode(e);
  const msg = getServerMessage(e) || fallbackMessage;
  return { code: code ?? serverCode, message: String(msg), at: nowIso() };
}

function firstLegacyAttachment(item: OutboxItem): PendingAttachment | null {
  const list = Array.isArray(item.attachments) ? item.attachments : [];
  for (const a of list) {
    if (!a) continue;
    if (!a.localUri || !a.filename || !a.mimeType) continue;
    // allow retry even if FAILED
    if (a.status === "UPLOADED") continue;
    return a;
  }
  return null;
}

async function localFileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!(info as any)?.exists;
  } catch {
    return false;
  }
}

async function deleteLocalFile(uri: string) {
  try {
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

async function readBase64FromUri(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any } as any);
  return stripDataPrefix(String(b64 || ""));
}

async function setItemState(id: string, patch: Partial<OutboxItem> & { status?: OutboxItemStatus }): Promise<void> {
  await updateOutboxItem(id, patch);
}

function shouldRetryWithoutMeta(e: any): boolean {
  // If backend rejects payload validation, retry once without meta.
  const code = getServerCode(e);
  if (code === "VALIDATION_FAILED" || code === "PRISMA_VALIDATION") return true;

  // fallback heuristic
  const msg = String(getServerMessage(e) ?? "").toLowerCase();
  if (!msg) return false;
  if (!msg.includes("meta")) return false;
  return msg.includes("unrecognized") || msg.includes("unknown") || msg.includes("unexpected") || msg.includes("invalid") || msg.includes("zod");
}

async function postLeadWithOptionalMetaFallback(args: {
  baseUrl: string;
  tenantSlug: string;
  timeoutMs: number;
  body: any;
}): Promise<{ usedMeta: boolean }> {
  const { baseUrl, tenantSlug, timeoutMs } = args;

  try {
    await mobilePostJson({
      baseUrl,
      tenantSlug,
      path: "/api/mobile/v1/leads",
      timeoutMs: Math.max(timeoutMs, 15000),
      body: args.body,
    });
    return { usedMeta: !!args.body?.meta };
  } catch (e: any) {
    if (args.body?.meta && shouldRetryWithoutMeta(e)) {
      const body2 = { ...args.body };
      delete body2.meta;

      await mobilePostJson({
        baseUrl,
        tenantSlug,
        path: "/api/mobile/v1/leads",
        timeoutMs: Math.max(timeoutMs, 15000),
        body: body2,
      });

      return { usedMeta: false };
    }

    throw e;
  }
}

async function syncOneInternal(args: {
  item: OutboxItem;
  baseUrl: string;
  tenantSlug: string;
  timeoutMs: number;
}): Promise<"OK" | "FAILED" | "SKIPPED"> {
  const { item, baseUrl, tenantSlug, timeoutMs } = args;

  if (isDemoLead(item)) {
    await setItemState(item.id, {
      status: "FAILED",
      lastError: { code: "DEMO", message: "Demo lead (local only) — delete this item when done testing.", at: nowIso() },
    });
    return "SKIPPED";
  }

  const attemptAt = nowIso();
  await setItemState(item.id, {
    status: "SYNCING",
    lastAttemptAt: attemptAt,
    lastError: undefined,
  });

  try {
    // Preferred: inline card base64 (new flow)
    let cardImageBase64 = stripDataPrefix(item.cardImageBase64 || "");

    // Legacy fallback: attachments[] -> read file base64 and send inline
    const legacyAtt = !cardImageBase64 ? firstLegacyAttachment(item) : null;
    if (legacyAtt) {
      const exists = await localFileExists(legacyAtt.localUri);
      if (!exists) {
        const err = { code: "LOCAL_FILE_MISSING", message: "Local attachment file missing.", at: nowIso() };

        const nextAttachments = (item.attachments ?? []).map((a) =>
          a.id === legacyAtt.id
            ? { ...a, status: "FAILED" as const, tries: (a.tries ?? 0) + 1, lastError: err.message }
            : a
        );

        await setItemState(item.id, {
          status: "FAILED",
          tries: (item.tries ?? 0) + 1,
          lastError: err,
          attachments: nextAttachments,
        });

        return "FAILED";
      }

      cardImageBase64 = await readBase64FromUri(legacyAtt.localUri);
    }

    // IMPORTANT: send only schema-safe fields
    const leadBody: any = {
      formId: item.formId,
      clientLeadId: item.clientLeadId,
      values: item.values ?? {},
      ...(cardImageBase64 ? { cardImageBase64 } : {}),
    };

    // meta optional (backend may reject -> fallback will retry without)
    if (item.meta && typeof item.meta === "object") {
      leadBody.meta = item.meta;
    }

    await postLeadWithOptionalMetaFallback({
      baseUrl,
      tenantSlug,
      timeoutMs,
      body: leadBody,
    });

    if (legacyAtt?.localUri) {
      await deleteLocalFile(legacyAtt.localUri);
    }

    await setItemState(item.id, { status: "DONE", lastSuccessAt: nowIso() });
    await removeOutboxItem(item.id);

    return "OK";
  } catch (e: any) {
    const err = toOutboxError(e, "Sync failed");

    const legacyAtt = firstLegacyAttachment(item);
    let nextAttachments = item.attachments;
    if (legacyAtt && Array.isArray(item.attachments)) {
      nextAttachments = item.attachments.map((a) =>
        a.id === legacyAtt.id
          ? { ...a, status: "FAILED" as const, tries: (a.tries ?? 0) + 1, lastError: err.message }
          : a
      );
    }

    await setItemState(item.id, {
      status: "FAILED",
      tries: (item.tries ?? 0) + 1,
      lastError: err,
      attachments: nextAttachments,
    });

    return "FAILED";
  }
}

export async function syncOutboxNow(args: {
  baseUrl?: string;
  tenantSlug?: string;
  reason?: string;
  isOnline?: boolean;
  timeoutMs?: number;
}): Promise<OutboxSyncSummary> {
  const reason = args.reason ?? "manual";
  const timeoutMs = args.timeoutMs ?? 8000;

  if (__syncMutex) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "busy", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (busy)", finishedAt };
  }

  if (args.isOnline === false) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "offline", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (offline)", finishedAt };
  }

  if (!args.baseUrl || !args.tenantSlug) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "settings", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Cannot sync: missing baseUrl/tenantSlug (Settings).", finishedAt };
  }

  __syncMutex = true;
  const startedAt = nowIso();
  emitStatus({ syncing: true, reason, startedAt });

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const current = await loadOutbox();

    if (!current.length) {
      const finishedAt = nowIso();
      emitStatus({ syncing: false, reason, startedAt, finishedAt, skipped: 1, skippedReason: "empty" });
      return { ok: 0, failed: 0, skipped: 1, message: "Outbox empty (nothing to sync).", finishedAt };
    }

    for (const item of current) {
      const r = await syncOneInternal({
        item,
        baseUrl: args.baseUrl,
        tenantSlug: args.tenantSlug,
        timeoutMs,
      });

      if (r === "OK") ok += 1;
      else if (r === "FAILED") failed += 1;
      else skipped += 1;
    }

    const finishedAt = nowIso();
    emitStatus({ syncing: false, reason, startedAt, finishedAt, ok, failed, skipped });
    return { ok, failed, skipped, message: `Sync finished: ok=${ok}, failed=${failed}, skipped=${skipped}`, finishedAt };
  } catch (e: any) {
    const finishedAt = nowIso();
    const msg = e?.message ? String(e.message) : "Sync error";
    emitStatus({ syncing: false, reason, startedAt, finishedAt, error: msg, ok, failed, skipped });
    return { ok, failed, skipped, message: `Sync error: ${msg}`, finishedAt };
  } finally {
    __syncMutex = false;
  }
}

export async function syncOutboxOne(args: {
  itemId: string;
  baseUrl?: string;
  tenantSlug?: string;
  reason?: string;
  isOnline?: boolean;
  timeoutMs?: number;
}): Promise<OutboxSyncSummary> {
  const reason = args.reason ?? `retry:${args.itemId}`;
  const timeoutMs = args.timeoutMs ?? 8000;

  if (__syncMutex) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "busy", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (busy)", finishedAt };
  }

  if (args.isOnline === false) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "offline", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (offline)", finishedAt };
  }

  if (!args.baseUrl || !args.tenantSlug) {
    const finishedAt = nowIso();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "settings", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Cannot sync: missing baseUrl/tenantSlug (Settings).", finishedAt };
  }

  __syncMutex = true;
  const startedAt = nowIso();
  emitStatus({ syncing: true, reason, startedAt });

  try {
    const current = await loadOutbox();
    const item = current.find((x) => x.id === args.itemId);

    if (!item) {
      const finishedAt = nowIso();
      emitStatus({ syncing: false, reason, startedAt, finishedAt, skipped: 1 });
      return { ok: 0, failed: 0, skipped: 1, message: "Item not found (already removed).", finishedAt };
    }

    const r = await syncOneInternal({
      item,
      baseUrl: args.baseUrl,
      tenantSlug: args.tenantSlug,
      timeoutMs,
    });

    const finishedAt = nowIso();
    const ok = r === "OK" ? 1 : 0;
    const failed = r === "FAILED" ? 1 : 0;
    const skipped = r === "SKIPPED" ? 1 : 0;

    emitStatus({ syncing: false, reason, startedAt, finishedAt, ok, failed, skipped });
    return { ok, failed, skipped, message: `Retry finished: ok=${ok}, failed=${failed}, skipped=${skipped}`, finishedAt };
  } catch (e: any) {
    const finishedAt = nowIso();
    const msg = e?.message ? String(e.message) : "Retry error";
    emitStatus({ syncing: false, reason, startedAt, finishedAt, error: msg });
    return { ok: 0, failed: 1, skipped: 0, message: `Retry error: ${msg}`, finishedAt };
  } finally {
    __syncMutex = false;
  }
}
