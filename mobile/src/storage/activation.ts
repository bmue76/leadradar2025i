import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_ACTIVATION = "lr:activation";

export type ActivationRecord = {
  active: boolean;
  expiresAt: string | null; // ISO string
  keyLast4: string | null;
  licenseKeyId: string | null;
  updatedAt: string; // ISO string
};

export function isActivationValidNow(rec: ActivationRecord): boolean {
  if (!rec.active) return false;
  if (!rec.expiresAt) return true; // fallback: active-without-expiry treated as valid
  const ts = Date.parse(rec.expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts > Date.now();
}

export async function loadActivation(): Promise<ActivationRecord> {
  const raw = await AsyncStorage.getItem(KEY_ACTIVATION);
  if (!raw) {
    return {
      active: false,
      expiresAt: null,
      keyLast4: null,
      licenseKeyId: null,
      updatedAt: new Date(0).toISOString(),
    };
  }

  try {
    const obj = JSON.parse(raw) as Partial<ActivationRecord>;
    return {
      active: typeof obj.active === "boolean" ? obj.active : false,
      expiresAt: typeof obj.expiresAt === "string" ? obj.expiresAt : null,
      keyLast4: typeof obj.keyLast4 === "string" ? obj.keyLast4 : null,
      licenseKeyId: typeof obj.licenseKeyId === "string" ? obj.licenseKeyId : null,
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
    };
  } catch {
    return {
      active: false,
      expiresAt: null,
      keyLast4: null,
      licenseKeyId: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function saveActivation(
  input: Omit<ActivationRecord, "updatedAt">
): Promise<ActivationRecord> {
  const rec: ActivationRecord = { ...input, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(KEY_ACTIVATION, JSON.stringify(rec));
  return rec;
}

export async function clearActivation(): Promise<void> {
  await AsyncStorage.removeItem(KEY_ACTIVATION);
}