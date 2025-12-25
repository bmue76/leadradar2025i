// mobile/src/storage/outbox.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_OUTBOX = "lr:outbox";

export type PendingAttachmentType = "IMAGE" | "PDF" | "OTHER";
export type PendingAttachmentStatus = "PENDING" | "UPLOADED" | "FAILED";

/**
 * Legacy / optional:
 * - We keep this for backward compatibility (older queued items)
 * - New flow stores card as cardImageBase64 instead of localUri file.
 */
export type PendingAttachment = {
  id: string;
  createdAt: string;

  type: PendingAttachmentType;

  // local file reference (Expo FileSystem uri)
  localUri: string;

  filename: string;
  mimeType: string;

  sizeBytes?: number;

  status: PendingAttachmentStatus;
  tries: number;
  lastError?: string;

  uploadedAt?: string;
};

export type OutboxItemStatus = "QUEUED" | "SYNCING" | "FAILED" | "DONE";

export type OutboxError = {
  code?: string;
  message: string;
  at: string; // ISO string
};

export type OutboxItem = {
  id: string;
  createdAt: string;

  formId: string;
  clientLeadId: string;
  capturedByDeviceUid?: string;

  values: Record<string, any>;

  // Resilience
  tries: number;
  lastError?: OutboxError | string; // allow legacy string, migration will convert best-effort
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  status?: OutboxItemStatus;

  // NEW: card inline (preferred)
  cardImageBase64?: string;
  cardImageMimeType?: string;
  cardImageFilename?: string;

  // Legacy/optional queue (kept for compatibility)
  attachments?: PendingAttachment[];
};

function isIsoString(s: any): s is string {
  return typeof s === "string" && s.length >= 10;
}

function normalizeStatus(raw: any, fallback: OutboxItemStatus): OutboxItemStatus {
  const s = typeof raw === "string" ? raw : "";
  if (s === "QUEUED" || s === "SYNCING" || s === "FAILED" || s === "DONE") return s;
  return fallback;
}

function normalizeError(raw: any, fallbackAt: string): OutboxError | string | undefined {
  if (!raw) return undefined;

  if (typeof raw === "string") {
    // legacy
    return {
      message: raw,
      at: fallbackAt,
    };
  }

  if (typeof raw === "object") {
    const msg = typeof raw.message === "string" ? raw.message : "";
    if (!msg) return undefined;

    const code = typeof raw.code === "string" ? raw.code : undefined;
    const at = isIsoString(raw.at) ? raw.at : fallbackAt;

    return { code, message: msg, at };
  }

  return undefined;
}

function normalizeItemWithMeta(raw: any): { item: OutboxItem | null; migrated: boolean } {
  let migrated = false;

  if (!raw || typeof raw !== "object") return { item: null, migrated: false };

  const id = typeof raw.id === "string" ? raw.id : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const formId = typeof raw.formId === "string" ? raw.formId : "";
  const clientLeadId = typeof raw.clientLeadId === "string" ? raw.clientLeadId : "";
  const values = raw.values && typeof raw.values === "object" ? raw.values : null;

  if (!id || !createdAt || !formId || !clientLeadId || !values) return { item: null, migrated: false };

  const tries = typeof raw.tries === "number" ? raw.tries : 0;
  if (typeof raw.tries !== "number") migrated = true;

  const capturedByDeviceUid = typeof raw.capturedByDeviceUid === "string" ? raw.capturedByDeviceUid : undefined;

  const lastAttemptAt = isIsoString(raw.lastAttemptAt) ? raw.lastAttemptAt : undefined;
  const lastSuccessAt = isIsoString(raw.lastSuccessAt) ? raw.lastSuccessAt : undefined;
  if (raw.lastAttemptAt && !lastAttemptAt) migrated = true;
  if (raw.lastSuccessAt && !lastSuccessAt) migrated = true;

  const fallbackAt = lastAttemptAt || createdAt || new Date().toISOString();
  const lastError = normalizeError(raw.lastError, fallbackAt);
  if (typeof raw.lastError === "string") migrated = true;

  // status: derive fallback
  const derivedFallback: OutboxItemStatus =
    tries > 0 || lastError ? "FAILED" : "QUEUED";
  const status = normalizeStatus(raw.status, derivedFallback);
  if (raw.status && typeof raw.status !== "string") migrated = true;

  const cardImageBase64 = typeof raw.cardImageBase64 === "string" ? raw.cardImageBase64 : undefined;
  const cardImageMimeType = typeof raw.cardImageMimeType === "string" ? raw.cardImageMimeType : undefined;
  const cardImageFilename = typeof raw.cardImageFilename === "string" ? raw.cardImageFilename : undefined;

  let attachments: PendingAttachment[] | undefined;
  if (Array.isArray(raw.attachments)) {
    const norm: PendingAttachment[] = [];
    for (const a of raw.attachments) {
      if (!a || typeof a !== "object") continue;

      const aid = typeof a.id === "string" ? a.id : "";
      const aCreatedAt = typeof a.createdAt === "string" ? a.createdAt : "";
      const localUri = typeof a.localUri === "string" ? a.localUri : "";
      const filename = typeof a.filename === "string" ? a.filename : "";
      const mimeType = typeof a.mimeType === "string" ? a.mimeType : "";
      const type = (typeof a.type === "string" ? a.type : "IMAGE") as PendingAttachmentType;
      const statusA = (typeof a.status === "string" ? a.status : "PENDING") as PendingAttachmentStatus;

      if (!aid || !aCreatedAt || !localUri || !filename || !mimeType) continue;

      norm.push({
        id: aid,
        createdAt: aCreatedAt,
        localUri,
        filename,
        mimeType,
        type: type === "PDF" || type === "OTHER" ? type : "IMAGE",
        status: statusA === "UPLOADED" || statusA === "FAILED" ? statusA : "PENDING",
        tries: typeof a.tries === "number" ? a.tries : 0,
        lastError: typeof a.lastError === "string" ? a.lastError : undefined,
        sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : undefined,
        uploadedAt: typeof a.uploadedAt === "string" ? a.uploadedAt : undefined,
      });
    }
    attachments = norm.length ? norm : undefined;
  }

  const item: OutboxItem = {
    id,
    createdAt,
    formId,
    clientLeadId,
    capturedByDeviceUid,
    values: values as Record<string, any>,

    tries,
    lastError,
    lastAttemptAt,
    lastSuccessAt,
    status,

    cardImageBase64,
    cardImageMimeType,
    cardImageFilename,

    attachments,
  };

  // Mark migration if any new keys missing on raw (best-effort)
  if (raw.lastAttemptAt === undefined && item.lastAttemptAt !== undefined) migrated = true;
  if (raw.lastSuccessAt === undefined && item.lastSuccessAt !== undefined) migrated = true;
  if (raw.status === undefined && item.status !== undefined) migrated = true;

  return { item, migrated };
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY_OUTBOX);
  if (!raw) return [];

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];

    const out: OutboxItem[] = [];
    let migrated = false;

    for (const item of data) {
      const { item: n, migrated: m } = normalizeItemWithMeta(item);
      if (n) out.push(n);
      if (m) migrated = true;
    }

    // Best-effort migration: persist normalized items once we detect legacy shapes
    if (migrated) {
      try {
        await AsyncStorage.setItem(KEY_OUTBOX, JSON.stringify(out));
      } catch {
        // ignore
      }
    }

    return out;
  } catch {
    return [];
  }
}

export async function saveOutbox(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY_OUTBOX, JSON.stringify(items));
}

export async function enqueueOutbox(item: OutboxItem): Promise<void> {
  const items = await loadOutbox();
  items.unshift(item);
  await saveOutbox(items);
}

export async function removeOutboxItem(id: string): Promise<void> {
  const items = await loadOutbox();
  await saveOutbox(items.filter((x) => x.id !== id));
}

export async function updateOutboxItem(id: string, patch: Partial<OutboxItem>): Promise<void> {
  const items = await loadOutbox();
  const next = items.map((x) => (x.id === id ? { ...x, ...patch } : x));
  await saveOutbox(next);
}

export async function clearOutbox(): Promise<void> {
  await saveOutbox([]);
}

export async function resetOutboxItemTries(id: string): Promise<void> {
  await updateOutboxItem(id, {
    tries: 0,
    lastError: undefined,
    lastAttemptAt: undefined,
    lastSuccessAt: undefined,
    status: "QUEUED",
  });
}

export async function resetAllOutboxTries(): Promise<void> {
  const items = await loadOutbox();
  const next = items.map((x) => ({
    ...x,
    tries: 0,
    lastError: undefined,
    lastAttemptAt: undefined,
    lastSuccessAt: undefined,
    status: "QUEUED" as const,
  }));
  await saveOutbox(next);
}
