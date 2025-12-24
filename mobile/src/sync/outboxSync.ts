import { DeviceEventEmitter } from "react-native";
import * as FileSystem from "expo-file-system";

import { mobilePostJson, mobilePostMultipart } from "../lib/mobileApi";
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

function firstPendingAttachment(item: OutboxItem): PendingAttachment | null {
  const list = Array.isArray(item.attachments) ? item.attachments : [];
  for (const a of list) {
    if (!a) continue;
    if (a.status === "UPLOADED") continue;
    if (!a.localUri || !a.filename || !a.mimeType) continue;
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
    // idempotent is not always typed in older SDKs → any
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
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
  const finishedAt = new Date().toISOString();
  const reason = args.reason ?? "manual";
  const timeoutMs = args.timeoutMs ?? 8000;

  if (__syncMutex) {
    emitStatus({ syncing: false, skipped: 1, skippedReason: "busy", reason, finishedAt });
    return {
      ok: 0,
      failed: 0,
      skipped: 1,
      message: "Sync skipped (busy)",
      finishedAt,
    };
  }

  if (args.isOnline === false) {
    emitStatus({ syncing: false, skipped: 1, skippedReason: "offline", reason, finishedAt });
    return {
      ok: 0,
      failed: 0,
      skipped: 1,
      message: "Sync skipped (offline)",
      finishedAt,
    };
  }

  if (!args.baseUrl || !args.tenantSlug) {
    emitStatus({ syncing: false, skipped: 1, skippedReason: "settings", reason, finishedAt });
    return {
      ok: 0,
      failed: 0,
      skipped: 1,
      message: "Cannot sync: missing baseUrl/tenantSlug (Settings).",
      finishedAt,
    };
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
      const fin = new Date().toISOString();
      emitStatus({ syncing: false, reason, startedAt, finishedAt: fin, skipped: 1, skippedReason: "empty" });
      return {
        ok: 0,
        failed: 0,
        skipped: 1,
        message: "Outbox empty (nothing to sync).",
        finishedAt: fin,
      };
    }

    for (const item of current) {
      // Demo items are local-only; backend can't accept them.
      if (isDemoLead(item)) {
        skipped += 1;
        await updateOutboxItem(item.id, {
          lastError: "Demo lead (local only) — delete this item when done testing.",
        });
        continue;
      }

      const att = firstPendingAttachment(item);

      try {
        // If we have a pending card, send Lead as multipart (payload + file)
        if (att) {
          const exists = await localFileExists(att.localUri);
          if (!exists) {
            failed += 1;

            const nextAttachments = (item.attachments ?? []).map((a) =>
              a.id === att.id
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

          await mobilePostMultipart({
            baseUrl: args.baseUrl,
            tenantSlug: args.tenantSlug,
            path: "/api/mobile/v1/leads",
            timeoutMs: Math.max(timeoutMs, 15000),
            fields: {
              payload: JSON.stringify({
                formId: item.formId,
                clientLeadId: item.clientLeadId,
                values: item.values,
                capturedByDeviceUid: item.capturedByDeviceUid,
              }),
              type: att.type || "IMAGE",
            },
            file: {
              uri: att.localUri,
              name: att.filename,
              mimeType: att.mimeType,
            },
          });

          ok += 1;

          // optional: cleanup local file when synced successfully
          await deleteLocalFile(att.localUri);

          await removeOutboxItem(item.id);
          continue;
        }

        // Otherwise: classic JSON lead sync
        await mobilePostJson({
          baseUrl: args.baseUrl,
          tenantSlug: args.tenantSlug,
          path: "/api/mobile/v1/leads",
          timeoutMs,
          body: {
            formId: item.formId,
            clientLeadId: item.clientLeadId,
            values: item.values,
            capturedByDeviceUid: item.capturedByDeviceUid,
          },
        });

        ok += 1;
        await removeOutboxItem(item.id);
      } catch (e: any) {
        failed += 1;
        const msg = e?.message ? String(e.message) : "Sync failed";

        // If attachment exists: mark it FAILED (keep queued)
        let nextAttachments = item.attachments;
        if (att && Array.isArray(item.attachments)) {
          nextAttachments = item.attachments.map((a) =>
            a.id === att.id
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

    const fin = new Date().toISOString();
    emitStatus({ syncing: false, reason, startedAt, finishedAt: fin, ok, failed, skipped });
    return {
      ok,
      failed,
      skipped,
      message: `Sync finished: ok=${ok}, failed=${failed}, skipped(demo)=${skipped}`,
      finishedAt: fin,
    };
  } catch (e: any) {
    const fin = new Date().toISOString();
    const msg = e?.message ? String(e.message) : "Sync error";
    emitStatus({ syncing: false, reason, startedAt, finishedAt: fin, ok, failed, skipped, error: msg });
    return {
      ok,
      failed: failed + 1,
      skipped,
      message: `Sync error: ${msg}`,
      finishedAt: fin,
    };
  } finally {
    __syncMutex = false;
  }
}
