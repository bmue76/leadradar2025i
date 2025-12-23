import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "lr:activation";

export type ActivationRecord = {
  active: boolean;
  expiresAt: string | null;
  keyLast4: string | null;
  licenseKeyId: string | null;

  // NEW: optional backend denial info (for StartScreen Reason UX)
  lastDeniedCode: string | null;
  lastDeniedMessage: string | null;
  lastDeniedAt: string | null;

  updatedAt: string;
};

const DEFAULT_RECORD: ActivationRecord = {
  active: false,
  expiresAt: null,
  keyLast4: null,
  licenseKeyId: null,

  lastDeniedCode: null,
  lastDeniedMessage: null,
  lastDeniedAt: null,

  updatedAt: new Date(0).toISOString(),
};

function asStringOrNull(v: any): string | null {
  return typeof v === "string" && v.length ? v : null;
}

function asBool(v: any): boolean {
  return v === true;
}

function normalize(input: any): ActivationRecord {
  const r = input ?? {};
  return {
    active: asBool(r.active),
    expiresAt: asStringOrNull(r.expiresAt),
    keyLast4: asStringOrNull(r.keyLast4),
    licenseKeyId: asStringOrNull(r.licenseKeyId),

    lastDeniedCode: asStringOrNull(r.lastDeniedCode),
    lastDeniedMessage: asStringOrNull(r.lastDeniedMessage),
    lastDeniedAt: asStringOrNull(r.lastDeniedAt),

    updatedAt: asStringOrNull(r.updatedAt) ?? DEFAULT_RECORD.updatedAt,
  };
}

export async function loadActivation(): Promise<ActivationRecord> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_RECORD;

  try {
    const json = JSON.parse(raw);
    return normalize(json);
  } catch {
    return DEFAULT_RECORD;
  }
}

export async function saveActivation(input: {
  active: boolean;
  expiresAt: string | null;
  keyLast4: string | null;
  licenseKeyId: string | null;

  lastDeniedCode?: string | null;
  lastDeniedMessage?: string | null;
  lastDeniedAt?: string | null;
}): Promise<ActivationRecord> {
  const prev = await loadActivation();
  const now = new Date().toISOString();

  const rec: ActivationRecord = {
    ...prev,
    active: input.active,
    expiresAt: input.expiresAt,
    keyLast4: input.keyLast4,
    licenseKeyId: input.licenseKeyId,

    lastDeniedCode: input.lastDeniedCode ?? prev.lastDeniedCode,
    lastDeniedMessage: input.lastDeniedMessage ?? prev.lastDeniedMessage,
    lastDeniedAt: input.lastDeniedAt ?? prev.lastDeniedAt,

    updatedAt: now,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  return rec;
}

export async function saveDenied(input: {
  code: string | null;
  message: string | null;
}): Promise<ActivationRecord> {
  const prev = await loadActivation();
  const now = new Date().toISOString();

  const rec: ActivationRecord = {
    ...prev,
    lastDeniedCode: input.code,
    lastDeniedMessage: input.message,
    lastDeniedAt: now,
    updatedAt: now,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  return rec;
}

export async function clearDenied(): Promise<ActivationRecord> {
  const prev = await loadActivation();
  const now = new Date().toISOString();

  const rec: ActivationRecord = {
    ...prev,
    lastDeniedCode: null,
    lastDeniedMessage: null,
    lastDeniedAt: null,
    updatedAt: now,
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  return rec;
}

export async function clearActivation(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * MVP-Regel:
 * - active=false => invalid
 * - expiresAt vorhanden => muss in Zukunft liegen
 * - expiresAt=null => gilt als valid-fallback (MVP)
 */
export function isActivationValidNow(rec: ActivationRecord): boolean {
  if (!rec.active) return false;
  if (!rec.expiresAt) return true;

  const ts = Date.parse(rec.expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts > Date.now();
}
