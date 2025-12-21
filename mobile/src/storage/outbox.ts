import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_OUTBOX = "lr:outbox";

export type OutboxItem = {
  id: string;
  createdAt: string;
  formId: string;
  clientLeadId: string;
  capturedByDeviceUid?: string;
  values: Record<string, any>;
  tries: number;
  lastError?: string;
};

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY_OUTBOX);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as OutboxItem[]) : [];
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
