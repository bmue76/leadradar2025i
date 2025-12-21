import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_BASE_URL = "lr:baseUrl";
const KEY_TENANT_SLUG = "lr:tenantSlug";
const KEY_DEVICE_UID = "lr:deviceUid";

export type Settings = {
  baseUrl: string;
  tenantSlug: string;
  deviceUid: string;
};

function fallbackUid() {
  // robust enough for MVP scaffold; UUID v4 kommt im nächsten Schritt sauber rein
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getOrCreateDeviceUid(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_DEVICE_UID);
  if (existing) return existing;

  const uid = fallbackUid();
  await AsyncStorage.setItem(KEY_DEVICE_UID, uid);
  return uid;
}

export async function loadSettings(): Promise<Omit<Settings, "deviceUid">> {
  const baseUrl = (await AsyncStorage.getItem(KEY_BASE_URL)) ?? "http://<LAN-IP>:3000";
  const tenantSlug = (await AsyncStorage.getItem(KEY_TENANT_SLUG)) ?? "";
  return { baseUrl, tenantSlug };
}

export async function saveSettings(input: { baseUrl: string; tenantSlug: string }) {
  await AsyncStorage.setItem(KEY_BASE_URL, input.baseUrl.trim());
  await AsyncStorage.setItem(KEY_TENANT_SLUG, input.tenantSlug.trim());
}
