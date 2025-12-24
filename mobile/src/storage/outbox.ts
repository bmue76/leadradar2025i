import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_OUTBOX = "lr:outbox";

export type PendingAttachmentType = "IMAGE" | "PDF" | "OTHER";
export type PendingAttachmentStatus = "PENDING" | "UPLOADED" | "FAILED";

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

export type OutboxItem = {
  id: string;
  createdAt: string;

  formId: string;
  clientLeadId: string;
  capturedByDeviceUid?: string;

  values: Record<string, any>;

  tries: number;
  lastError?: string;

  // NEW (3.4B): optional attachments queue
  attachments?: PendingAttachment[];
};

function normalizeItem(raw: any): OutboxItem | null {
  if (!raw || typeof raw !== "object") return null;

  const id = typeof raw.id === "string" ? raw.id : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const formId = typeof raw.formId === "string" ? raw.formId : "";
  const clientLeadId = typeof raw.clientLeadId === "string" ? raw.clientLeadId : "";
  const values = raw.values && typeof raw.values === "object" ? raw.values : null;

  if (!id || !createdAt || !formId || !clientLeadId || !values) return null;

  const tries = typeof raw.tries === "number" ? raw.tries : 0;
  const lastError = typeof raw.lastError === "string" ? raw.lastError : undefined;
  const capturedByDeviceUid = typeof raw.capturedByDeviceUid === "string" ? raw.capturedByDeviceUid : undefined;

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
      const status = (typeof a.status === "string" ? a.status : "PENDING") as PendingAttachmentStatus;

      if (!aid || !aCreatedAt || !localUri || !filename || !mimeType) continue;

      norm.push({
        id: aid,
        createdAt: aCreatedAt,
        localUri,
        filename,
        mimeType,
        type: type === "PDF" || type === "OTHER" ? type : "IMAGE",
        status: status === "UPLOADED" || status === "FAILED" ? status : "PENDING",
        tries: typeof a.tries === "number" ? a.tries : 0,
        lastError: typeof a.lastError === "string" ? a.lastError : undefined,
        sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : undefined,
        uploadedAt: typeof a.uploadedAt === "string" ? a.uploadedAt : undefined,
      });
    }
    attachments = norm.length ? norm : undefined;
  }

  return {
    id,
    createdAt,
    formId,
    clientLeadId,
    capturedByDeviceUid,
    values: values as Record<string, any>,
    tries,
    lastError,
    attachments,
  };
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY_OUTBOX);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out: OutboxItem[] = [];
    for (const item of data) {
      const n = normalizeItem(item);
      if (n) out.push(n);
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
