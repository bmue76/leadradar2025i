import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_FORMS_LIST = "lr:cache:forms:list";
const KEY_FORMS_LIST_META = "lr:cache:forms:list:meta";
const KEY_FORM_DETAIL_PREFIX = "lr:cache:forms:detail:";
const KEY_FORM_DETAIL_META_PREFIX = "lr:cache:forms:detail:meta:";

export type CacheMeta = {
  updatedAt: string; // ISO
};

export async function saveFormsListCache(payload: unknown) {
  const meta: CacheMeta = { updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(KEY_FORMS_LIST, JSON.stringify(payload));
  await AsyncStorage.setItem(KEY_FORMS_LIST_META, JSON.stringify(meta));
  return meta;
}

export async function loadFormsListCache(): Promise<{ payload: any | null; meta: CacheMeta | null }> {
  const raw = await AsyncStorage.getItem(KEY_FORMS_LIST);
  const rawMeta = await AsyncStorage.getItem(KEY_FORMS_LIST_META);

  let payload: any | null = null;
  let meta: CacheMeta | null = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  try {
    meta = rawMeta ? (JSON.parse(rawMeta) as CacheMeta) : null;
  } catch {
    meta = null;
  }

  return { payload, meta };
}

export async function saveFormDetailCache(formId: string, payload: unknown) {
  const meta: CacheMeta = { updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(`${KEY_FORM_DETAIL_PREFIX}${formId}`, JSON.stringify(payload));
  await AsyncStorage.setItem(`${KEY_FORM_DETAIL_META_PREFIX}${formId}`, JSON.stringify(meta));
  return meta;
}

export async function loadFormDetailCache(formId: string): Promise<{ payload: any | null; meta: CacheMeta | null }> {
  const raw = await AsyncStorage.getItem(`${KEY_FORM_DETAIL_PREFIX}${formId}`);
  const rawMeta = await AsyncStorage.getItem(`${KEY_FORM_DETAIL_META_PREFIX}${formId}`);

  let payload: any | null = null;
  let meta: CacheMeta | null = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  try {
    meta = rawMeta ? (JSON.parse(rawMeta) as CacheMeta) : null;
  } catch {
    meta = null;
  }

  return { payload, meta };
}
