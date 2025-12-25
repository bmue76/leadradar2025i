// mobile/src/sync/outboxSync.ts
import { DeviceEventEmitter } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import { mobilePostJson } from "../lib/mobileApi";
import { DEMO_FORM_ID } from "../lib/demoForms";
import {
  loadOutbox,
  removeOutboxItem,
  updateOutboxItem,
  type OutboxItem,
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
  // Expo SDK typings differ → use string literal (TS-safe)
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any } as any);
  return stripDataPrefix(String(b64 || ""));
}

/**
 * Single entry-point for manual + auto sync.
 * - Mutex prevents parallel runs (manual + auto)
 * - Never throws for per-item failures; returns summary
 */
export async function syncOutboxNow(args: {
  baseUrl?: string;
  tenantSlug?: string;
  reason?: string; // "manual" | "start" | "foreground" | "online" | "retry:*"
  isOnline?: boolean;
  timeoutMs?: number; // default 8000
}): Promise<OutboxSyncSummary> {
  const reason = args.reason ?? "manual";
  const timeoutMs = args.timeoutMs ?? 8000;

  if (__syncMutex) {
    const finishedAt = new Date().toISOString();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "busy", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (busy)", finishedAt };
  }

  if (args.isOnline === false) {
    const finishedAt = new Date().toISOString();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "offline", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Sync skipped (offline)", finishedAt };
  }

  if (!args.baseUrl || !args.tenantSlug) {
    const finishedAt = new Date().toISOString();
    emitStatus({ syncing: false, skipped: 1, skippedReason: "settings", reason, finishedAt });
    return { ok: 0, failed: 0, skipped: 1, message: "Cannot sync: missing baseUrl/tenantSlug (Settings).", finishedAt };
  }

  __syncMutex = true;
  const startedAt = new Date().toISOString();
  emitStatus({ syncing: true, reason, startedAt });

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const current = await loadOutbox();

    if (!current.length) {
      const finishedAt = new Date().toISOString();
      emitStatus({ syncing: false, reason, startedAt, finishedAt, skipped: 1, skippedReason: "empty" });
      return { ok: 0, failed: 0, skipped: 1, message: "Outbox empty (nothing to sync).", finishedAt };
    }

    for (const item of current) {
      if (isDemoLead(item)) {
        skipped += 1;
        await updateOutboxItem(item.id, {
          lastError: "Demo lead (local only) — delete this item when done testing.",
        });
        continue;
      }

      try {
        // Preferred: inline card base64 (new flow)
        let cardImageBase64 = stripDataPrefix(item.cardImageBase64 || "");
        let cardImageMimeType = String(item.cardImageMimeType || "image/jpeg");
        let cardImageFilename = String(item.cardImageFilename || "businesscard.jpg");

        // Legacy fallback: attachments[] -> read file base64 and send inline
        const legacyAtt = !cardImageBase64 ? firstLegacyAttachment(item) : null;
        if (legacyAtt) {
          const exists = await localFileExists(legacyAtt.localUri);
          if (!exists) {
            failed += 1;

            const nextAttachments = (item.attachments ?? []).map((a) =>
              a.id === legacyAtt.id
                ? {
                    ...a,
                    status: "FAILED" as const,
                    tries: (a.tries ?? 0) + 1,
                    lastError: "Local attachment file missing.",
                  }
                : a
            );

            await updateOutboxItem(item.id, {
              tries: (item.tries ?? 0) + 1,
              lastError: "Local attachment file missing.",
              attachments: nextAttachments,
            });
            continue;
          }

          cardImageBase64 = await readBase64FromUri(legacyAtt.localUri);
          cardImageMimeType = legacyAtt.mimeType || cardImageMimeType;
          cardImageFilename = legacyAtt.filename || cardImageFilename;
        }

        // Post lead (JSON)
        await mobilePostJson({
          baseUrl: args.baseUrl,
          tenantSlug: args.tenantSlug,
          path: "/api/mobile/v1/leads",
          timeoutMs: Math.max(timeoutMs, 15000),
          body: {
            formId: item.formId,
            clientLeadId: item.clientLeadId,
            values: item.values,
            capturedByDeviceUid: item.capturedByDeviceUid,

            // include only if present (server accepts optional)
            ...(cardImageBase64
              ? {
                  cardImageBase64,
                  cardImageMimeType,
                  cardImageFilename,
                }
              : {}),
          },
        });

        ok += 1;

        // cleanup legacy local file if we used it
        if (legacyAtt?.localUri) {
          await deleteLocalFile(legacyAtt.localUri);
        }

        await removeOutboxItem(item.id);
      } catch (e: any) {
        failed += 1;
        const msg = e?.message ? String(e.message) : "Sync failed";

        // mark legacy attachment as FAILED (keep queued)
        const legacyAtt = firstLegacyAttachment(item);
        let nextAttachments = item.attachments;
        if (legacyAtt && Array.isArray(item.attachments)) {
          nextAttachments = item.attachments.map((a) =>
            a.id === legacyAtt.id
              ? {
                  ...a,
                  status: "FAILED" as const,
                  tries: (a.tries ?? 0) + 1,
                  lastError: msg,
                }
              : a
          );
        }

        await updateOutboxItem(item.id, {
          tries: (item.tries ?? 0) + 1,
          lastError: msg,
          attachments: nextAttachments,
        });
      }
    }

    const finishedAt = new Date().toISOString();
    emitStatus({ syncing: false, reason, startedAt, finishedAt, ok, failed, skipped });
    return {
      ok,
      failed,
      skipped,
      message: `Sync finished: ok=${ok}, failed=${failed}, skipped(demo)=${skipped}`,
      finishedAt,
    };
  } catch (e: any) {
    const finishedAt = new Date().toISOString();
    const msg = e?.message ? String(e.message) : "Sync error";
    emitStatus({ syncing: false, reason, startedAt, finishedAt, ok, failed, skipped, error: msg });
    return {
      ok,
      failed: failed + 1,
      skipped,
      message: `Sync error: ${msg}`,
      finishedAt,
    };
  } finally {
    __syncMutex = false;
  }
}
