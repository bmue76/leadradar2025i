import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useNetInfo } from "@react-native-community/netinfo";

import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

import type { RootStackParamList } from "../navigation/types";
import { useSettings } from "../storage/SettingsContext";
import { mobileGetJson, mobilePostJson } from "../lib/mobileApi";
import { uuidv4 } from "../lib/uuid";
import { enqueueOutbox } from "../storage/outbox";
import { loadFormDetailCache, saveFormDetailCache } from "../storage/formsCache";
import { DEMO_FORM_ID, getDemoFormDetail } from "../lib/demoForms";

import { recognizeText } from "../ocr/recognizeText";
import { parseBusinessCard } from "../ocr/parseBusinessCard";
import type { LeadOcrMetaV1, OcrFieldKey } from "../ocr/types";

type R = RouteProp<RootStackParamList, "Capture">;

type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "CHECKBOX"
  | "DATE"
  | "DATETIME"
  | "URL"
  | "SELECT"
  | "MULTISELECT";

type FieldConfig = {
  options?: Array<string | { label?: string; value?: string }>;
  [k: string]: unknown;
};

type MobileFormField = {
  id: string;
  key?: string;
  label?: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string | null;
  helpText?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
  config?: FieldConfig | null;
};

type MobileFormDetail = {
  id: string;
  name?: string;
  fields?: MobileFormField[];
};

type PendingCard = {
  id: string;
  createdAt: string;
  filename: string;
  mimeType: string; // "image/jpeg"
  base64: string; // WITHOUT data: prefix
};

function unwrapPayload(raw: any) {
  if (raw && typeof raw === "object" && "data" in raw) return (raw as any).data;
  return raw;
}

function normalizeOptions(config: FieldConfig | null | undefined): Array<{ label: string; value: string }> {
  const raw = config?.options;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; value: string }> = [];

  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ label: item, value: item });
      continue;
    }
    if (item && typeof item === "object") {
      const v = typeof (item as any).value === "string" ? (item as any).value : "";
      const l = typeof (item as any).label === "string" ? (item as any).label : v;
      if (v) out.push({ label: l || v, value: v });
    }
  }
  return out;
}

function fieldKey(f: MobileFormField) {
  return (f.key && String(f.key)) || String(f.id);
}

function basenameFromUri(uri: string): string {
  try {
    const clean = uri.split("?")[0] || uri;
    const parts = clean.split("/").filter(Boolean);
    return parts[parts.length - 1] || "card.jpg";
  } catch {
    return "card.jpg";
  }
}

function ensureJpgName(name: string) {
  const n = name.trim() || "card.jpg";
  return /\.(jpe?g)$/i.test(n) ? n : `${n}.jpg`;
}

async function deleteLocalFile(uri: string) {
  try {
    await (FileSystem as any).deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

function getBase64EncodingValue() {
  return ((FileSystem as any).EncodingType?.Base64 ?? "base64") as any;
}

async function readBase64FromUri(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: getBase64EncodingValue() } as any);
  return String(b64 || "");
}

function isDev() {
  return typeof __DEV__ !== "undefined" && !!__DEV__;
}

function lc(s: any) {
  return String(s ?? "").toLowerCase();
}

function isStringishFieldType(t: FieldType) {
  return t === "TEXT" || t === "TEXTAREA" || t === "EMAIL" || t === "PHONE" || t === "URL" || t === "NUMBER";
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

function getHttpStatusFromError(e: any): number | undefined {
  const candidates = [
    e?.status,
    e?.statusCode,
    e?.response?.status,
    e?.res?.status,
    e?.httpStatus,
    e?.data?.status,
    e?.data?.error?.status,
    e?.body?.status,
    e?.body?.error?.status,
  ]
    .map((x) => (typeof x === "number" ? x : undefined))
    .filter((x) => typeof x === "number") as number[];

  if (candidates.length) return candidates[0];

  const msg = String(e?.message ?? "");
  const m = msg.match(/\b(4\d{2}|5\d{2})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }

  return undefined;
}

function getApiCodeFromError(e: any): string | undefined {
  return (
    (typeof e?.error?.code === "string" && e.error.code) ||
    (typeof e?.data?.error?.code === "string" && e.data.error.code) ||
    (typeof e?.body?.error?.code === "string" && e.body.error.code) ||
    (typeof e?.code === "string" && e.code) ||
    undefined
  );
}

function getApiMessageFromError(e: any): string {
  return (
    (typeof e?.error?.message === "string" && e.error.message) ||
    (typeof e?.data?.error?.message === "string" && e.data.error.message) ||
    (typeof e?.body?.error?.message === "string" && e.body.error.message) ||
    (typeof e?.message === "string" && e.message) ||
    "Unknown error"
  );
}

function shouldRetryWithoutMeta(e: any): boolean {
  const msg = String(getApiMessageFromError(e) ?? "").toLowerCase();
  if (!msg.includes("meta")) return false;
  return (
    msg.includes("unrecognized") ||
    msg.includes("unknown") ||
    msg.includes("unexpected") ||
    msg.includes("invalid") ||
    msg.includes("zod")
  );
}

function isTransientNetworkLikeError(e: any): boolean {
  const msg = String(getApiMessageFromError(e) ?? "").toLowerCase();
  if (
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  ) {
    return true;
  }
  const status = getHttpStatusFromError(e);
  if (typeof status === "number" && status >= 500) return true;
  return false;
}

// Outbox nur offline/transient, NICHT bei 4xx (422 etc)
function shouldQueueOnSaveError(args: { e: any; networkOnline: boolean | null; hasBaseUrl: boolean }): boolean {
  const { e, networkOnline, hasBaseUrl } = args;

  if (!hasBaseUrl) return true;
  if (networkOnline === false) return true;

  const status = getHttpStatusFromError(e);
  const apiCode = getApiCodeFromError(e);

  if (apiCode === "VALIDATION_FAILED") return false;
  if (typeof status === "number" && status >= 400 && status < 500) return false;

  return isTransientNetworkLikeError(e);
}

async function createLeadOnline(args: {
  baseUrl: string;
  tenantSlug: string;
  formId: string;
  clientLeadId: string;
  values: any;
  meta?: any;
}): Promise<{ leadId: string; created?: boolean; usedMeta: boolean }> {
  const { baseUrl, tenantSlug, formId, clientLeadId, values, meta } = args;

  // Candidate bodies (progressive hardening)
  const candidates: Array<{ body: any; usedMeta: boolean }> = [];

  // 1) with meta (if present)
  if (meta && typeof meta === "object") {
    candidates.push({
      body: { formId, clientLeadId, values, meta },
      usedMeta: true,
    });
  }

  // 2) without meta (always)
  candidates.push({
    body: { formId, clientLeadId, values },
    usedMeta: false,
  });

  let lastErr: any = null;

  for (const c of candidates) {
    try {
      const raw = await mobilePostJson({
        baseUrl,
        tenantSlug,
        path: "/api/mobile/v1/leads",
        timeoutMs: 15000,
        body: c.body,
      });

      const payload = unwrapPayload(raw);
      const leadId = String((payload as any)?.id ?? "");
      const created = (payload as any)?.created;

      if (!leadId) {
        throw new Error("Lead created but response missing id.");
      }

      return { leadId, created, usedMeta: c.usedMeta };
    } catch (e: any) {
      lastErr = e;

      // If meta rejected, retry without meta even if status isn't cleanly detectable
      if (c.usedMeta && shouldRetryWithoutMeta(e)) {
        continue;
      }

      // If this candidate fails with 4xx validation, try next (schema might not accept meta)
      const status = getHttpStatusFromError(e);
      if (typeof status === "number" && status >= 400 && status < 500) {
        continue;
      }

      // Non-4xx: stop early
      throw e;
    }
  }

  throw lastErr ?? new Error("Create lead failed.");
}

async function uploadBusinessCardAttachmentOnline(args: {
  baseUrl: string;
  tenantSlug: string;
  leadId: string;
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<void> {
  const { baseUrl, tenantSlug, leadId, filename, mimeType } = args;
  const b64 = stripDataPrefix(args.base64);

  // try a few common schemas (backend typings may differ)
  const common = { filename, mimeType, kind: "BUSINESS_CARD" };
  const candidates: any[] = [
    { ...common, base64: b64 },
    { ...common, fileBase64: b64 },
    { ...common, contentBase64: b64 },
    { ...common, dataBase64: b64 },
    { ...common, file: { filename, mimeType, base64: b64 } },
  ];

  let lastErr: any = null;

  for (const body of candidates) {
    try {
      await mobilePostJson({
        baseUrl,
        tenantSlug,
        path: `/api/mobile/v1/leads/${encodeURIComponent(leadId)}/attachments`,
        timeoutMs: 20000,
        body,
      });
      return;
    } catch (e: any) {
      lastErr = e;
      const status = getHttpStatusFromError(e);
      // try next only for 4xx schema mismatch
      if (typeof status === "number" && status >= 400 && status < 500) continue;

      // if we cannot parse status but message suggests validation, also continue
      const msg = String(getApiMessageFromError(e) ?? "").toLowerCase();
      if (msg.includes("validation") || msg.includes("invalid input") || msg.includes("unprocessable")) continue;

      throw e;
    }
  }

  throw lastErr ?? new Error("Attachment upload failed.");
}

export default function CaptureScreen() {
  const route = useRoute<R>();
  const { formId, formName } = route.params;

  const { isLoaded, baseUrl, tenantSlug, deviceUid } = useSettings();
  const netInfo = useNetInfo();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [form, setForm] = useState<MobileFormDetail | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});

  // Card required (base64)
  const [card, setCard] = useState<PendingCard | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  // Keep same clientLeadId on retry to avoid duplicates (idempotent)
  const [pendingClientLeadId, setPendingClientLeadId] = useState<string | null>(null);

  // OCR
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  const [ocrMeta, setOcrMeta] = useState<LeadOcrMetaV1 | null>(null);
  const [ocrApply, setOcrApply] = useState<Partial<Record<OcrFieldKey, boolean>>>({});
  const [ocrOverwrite, setOcrOverwrite] = useState(false);
  const [showOcrRaw, setShowOcrRaw] = useState(false);

  const canLoad = useMemo(() => isLoaded && !!tenantSlug && !!formId, [isLoaded, tenantSlug, formId]);

  // tri-state online
  const networkOnline: boolean | null = useMemo(() => {
    if (netInfo.isInternetReachable === false) return false;
    if (netInfo.isConnected === false) return false;
    if (netInfo.isConnected === true) return true;
    return null;
  }, [netInfo.isConnected, netInfo.isInternetReachable]);

  const fields = useMemo(() => {
    const list = form?.fields ?? [];
    const active = list.filter((f) => f && typeof f === "object" && f.isActive !== false);
    return [...active].sort((a, b) => {
      const sa = typeof a.sortOrder === "number" ? a.sortOrder : 0;
      const sb = typeof b.sortOrder === "number" ? b.sortOrder : 0;
      if (sa !== sb) return sa - sb;
      return String(fieldKey(a)).localeCompare(String(fieldKey(b)));
    });
  }, [form]);

  function initDefaults(nextFields: MobileFormField[]) {
    setValues((prev) => {
      const next = { ...prev };
      for (const field of nextFields) {
        const k = fieldKey(field);
        if (next[k] !== undefined) continue;
        switch (field.type) {
          case "CHECKBOX":
            next[k] = false;
            break;
          case "MULTISELECT":
            next[k] = [];
            break;
          default:
            next[k] = "";
        }
      }
      return next;
    });
  }

  function resetValues() {
    const next: Record<string, any> = {};
    for (const f of fields) {
      const k = fieldKey(f);
      switch (f.type) {
        case "CHECKBOX":
          next[k] = false;
          break;
        case "MULTISELECT":
          next[k] = [];
          break;
        default:
          next[k] = "";
      }
    }
    setValues(next);
  }

  function applyFormObject(f: MobileFormDetail, note?: string) {
    const normalized: MobileFormDetail = {
      id: String((f as any).id ?? formId),
      name: (f as any).name,
      fields: Array.isArray((f as any).fields) ? ((f as any).fields as any) : [],
    };
    setForm(normalized);
    initDefaults(normalized.fields ?? []);
    if (note) setInfo(note);
  }

  async function load() {
    if (!canLoad) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      if (formId === DEMO_FORM_ID) {
        const demo = getDemoFormDetail(formId);
        if (demo) {
          applyFormObject(demo as any, "Offline → using Demo Form");
          return;
        }
      }

      if (!baseUrl) {
        const cached = await loadFormDetailCache(formId);
        if (cached.payload) {
          const raw = cached.payload;
          const payload = unwrapPayload(raw);

          const f: any = (payload?.form ?? payload) as any;
          if (!Array.isArray(f.fields) && Array.isArray(payload?.fields)) f.fields = payload.fields;

          applyFormObject(f as any, `Offline → using cached form (last: ${cached.meta?.updatedAt ?? "unknown"})`);
          return;
        }

        setError("No baseUrl and no cached form. Load once online to make it offline-ready.");
        setForm(null);
        setValues({});
        return;
      }

      const raw = await mobileGetJson<any>({
        baseUrl,
        tenantSlug: tenantSlug!,
        path: `/api/mobile/v1/forms/${encodeURIComponent(formId)}`,
      });

      const payload = unwrapPayload(raw);

      const f: any = (payload?.form ?? payload) as any;
      if (!Array.isArray(f.fields) && Array.isArray(payload?.fields)) f.fields = payload.fields;

      applyFormObject(f as any);

      const meta = await saveFormDetailCache(formId, raw);
      setInfo(`Online ✓ (cached ${meta.updatedAt})`);
    } catch (e: any) {
      const cached = await loadFormDetailCache(formId);
      if (cached.payload) {
        const raw = cached.payload;
        const payload = unwrapPayload(raw);

        const f: any = (payload?.form ?? payload) as any;
        if (!Array.isArray(f.fields) && Array.isArray(payload?.fields)) f.fields = payload.fields;

        applyFormObject(f as any, `Offline → using cached form (last: ${cached.meta?.updatedAt ?? "unknown"})`);
        return;
      }

      const demo = getDemoFormDetail(formId);
      if (demo) {
        applyFormObject(demo as any, "Offline → using Demo Form (no cache)");
        return;
      }

      setError(e?.message ? String(e.message) : "Failed to load form detail.");
      setForm(null);
      setValues({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, baseUrl, tenantSlug, formId]);

  useEffect(() => {
    setOcrError(null);
    setOcrInfo(null);
    setOcrMeta(null);
    setOcrApply({});
    setOcrOverwrite(false);
    setShowOcrRaw(false);
  }, [card?.id]);

  function setValue(k: string, v: any) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function toggleMulti(k: string, optionValue: string) {
    setValues((prev) => {
      const cur = Array.isArray(prev[k]) ? (prev[k] as string[]) : [];
      const has = cur.includes(optionValue);
      const next = has ? cur.filter((x) => x !== optionValue) : [...cur, optionValue];
      return { ...prev, [k]: next };
    });
  }

  function validateRequired(): string[] {
    const missing: string[] = [];
    for (const f of fields) {
      if (f.required !== true) continue;
      const k = fieldKey(f);
      const label = String(f.label ?? f.key ?? k);
      const v = values[k];

      if (f.type === "CHECKBOX") {
        if (v !== true) missing.push(label);
        continue;
      }
      if (f.type === "MULTISELECT") {
        if (!Array.isArray(v) || v.length === 0) missing.push(label);
        continue;
      }
      if (typeof v !== "string" || v.trim() === "") missing.push(label);
    }
    return missing;
  }

  async function pickBusinessCard(source: "camera" | "library") {
    setCardBusy(true);
    setError(null);
    setInfo(null);

    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Kamera nicht erlaubt", "Bitte Kamera-Berechtigung erlauben.");
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Galerie nicht erlaubt", "Bitte Medien-Berechtigung erlauben.");
          return;
        }
      }

      const res =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaType.Images,
              quality: 0.35,
              allowsEditing: false,
              exif: false,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaType.Images,
              quality: 0.35,
              allowsEditing: false,
              exif: false,
            });

      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      let finalUri = asset.uri;
      try {
        const width = asset.width || 1100;
        const targetW = Math.min(1100, width);
        const manipulated = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: targetW } }],
          { compress: 0.35, format: ImageManipulator.SaveFormat.JPEG }
        );
        if (manipulated?.uri) finalUri = manipulated.uri;
      } catch {
        // ignore
      }

      const filename = ensureJpgName(asset.fileName || basenameFromUri(finalUri) || "businesscard.jpg");
      const base64 = stripDataPrefix(await readBase64FromUri(finalUri));

      if (finalUri && finalUri !== asset.uri) {
        await deleteLocalFile(finalUri);
      }

      const now = new Date().toISOString();
      setCard({
        id: await uuidv4(),
        createdAt: now,
        filename,
        mimeType: "image/jpeg",
        base64,
      });

      // new capture -> new idempotency id
      setPendingClientLeadId(null);

      setInfo("Visitenkarte bereit (Base64). ✅");
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Visitenkarte konnte nicht erfasst werden.");
    } finally {
      setCardBusy(false);
    }
  }

  async function removeCard() {
    setCard(null);
    setPendingClientLeadId(null);
  }

  async function writeTempJpgFromBase64(base64: string): Promise<string> {
    const safeRand = Math.random().toString(16).slice(2);
    const uri = `${FileSystem.cacheDirectory ?? ""}ocr_${Date.now()}_${safeRand}.jpg`;
    if (!uri) throw new Error("No cacheDirectory available to write temp OCR file.");
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: getBase64EncodingValue() } as any);
    return uri;
  }

  function findFieldByType(t: FieldType) {
    return fields.find((f) => f.type === t && f.isActive !== false) ?? null;
  }

  function findFieldByTextHints(hints: string[]) {
    const hs = hints.map((h) => h.toLowerCase());
    for (const f of fields) {
      if (f.isActive === false) continue;
      const hay = `${lc(f.key)} ${lc(f.label)}`;
      if (hs.some((h) => hay.includes(h))) return f;
    }
    return null;
  }

  function pickTargetField(kind: OcrFieldKey): MobileFormField | null {
    if (kind === "email") return findFieldByType("EMAIL") ?? findFieldByTextHints(["email", "e-mail", "mail"]);
    if (kind === "phone") return findFieldByType("PHONE") ?? findFieldByTextHints(["phone", "telefon", "tel", "mobile", "handy"]);
    if (kind === "url") return findFieldByType("URL") ?? findFieldByTextHints(["web", "website", "url", "homepage"]);
    if (kind === "company") return findFieldByTextHints(["company", "firma", "unternehmen", "organisation", "organization"]) ?? null;
    if (kind === "name") return findFieldByTextHints(["name", "kontakt", "ansprechpartner", "person"]) ?? null;
    return null;
  }

  function findNameSplitTargets(): { first?: MobileFormField | null; last?: MobileFormField | null } {
    const first = findFieldByTextHints(["vorname", "firstname", "first name", "given name"]) ?? null;
    const last = findFieldByTextHints(["nachname", "lastname", "last name", "surname", "family name"]) ?? null;
    return { first, last };
  }

  async function onOcrScan() {
    if (!card?.base64) {
      Alert.alert("Keine Visitenkarte", "Bitte zuerst eine Visitenkarte aufnehmen oder aus der Galerie wählen.");
      return;
    }

    setOcrBusy(true);
    setOcrError(null);
    setOcrInfo(null);

    let tmpUri: string | null = null;

    try {
      tmpUri = await writeTempJpgFromBase64(card.base64);

      const rec = await recognizeText(tmpUri);
      const parsed = parseBusinessCard(rec);

      const meta: LeadOcrMetaV1 = {
        version: 1,
        provider: "mlkit-text-recognition",
        createdAt: new Date().toISOString(),
        rawText: rec.rawText,
        extracted: parsed.extracted,
        confidence: parsed.confidence,
        notes: parsed.notes,
      };

      const nextApply: Partial<Record<OcrFieldKey, boolean>> = {};
      (["email", "phone", "url", "name", "company"] as OcrFieldKey[]).forEach((k) => {
        if ((meta.extracted as any)?.[k]) nextApply[k] = true;
      });

      setOcrMeta(meta);
      setOcrApply(nextApply);
      setOcrInfo("OCR fertig. ✅");
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "OCR fehlgeschlagen.";
      setOcrError(msg);
    } finally {
      if (tmpUri) await deleteLocalFile(tmpUri);
      setOcrBusy(false);
    }
  }

  function applyOcrToValues() {
    if (!ocrMeta) return;

    const extracted = ocrMeta.extracted ?? {};
    const chosen: OcrFieldKey[] = (["email", "phone", "url", "name", "company"] as OcrFieldKey[]).filter(
      (k) => !!ocrApply?.[k] && typeof (extracted as any)[k] === "string" && String((extracted as any)[k]).trim() !== ""
    );

    if (chosen.length === 0) {
      Alert.alert("Keine Auswahl", "Bitte mindestens einen Vorschlag auswählen.");
      return;
    }

    setValues((prev) => {
      const next = { ...prev };

      const nameVal = typeof (extracted as any).name === "string" ? String((extracted as any).name).trim() : "";
      const splitTargets = findNameSplitTargets();

      for (const kind of chosen) {
        const val = String((extracted as any)[kind] ?? "").trim();
        if (!val) continue;

        if (kind === "name" && nameVal && splitTargets.first && splitTargets.last) {
          const fk = fieldKey(splitTargets.first);
          const lk = fieldKey(splitTargets.last);

          const parts = nameVal.split(/\s+/g).filter(Boolean);
          const first = parts[0] ?? "";
          const last = parts.slice(1).join(" ").trim();

          if (first) {
            const cur = typeof next[fk] === "string" ? String(next[fk]).trim() : "";
            if (ocrOverwrite || !cur) next[fk] = first;
          }
          if (last) {
            const cur = typeof next[lk] === "string" ? String(next[lk]).trim() : "";
            if (ocrOverwrite || !cur) next[lk] = last;
          }
          continue;
        }

        const target = pickTargetField(kind);
        if (!target) continue;
        if (!isStringishFieldType(target.type)) continue;

        const k = fieldKey(target);
        const cur = typeof next[k] === "string" ? String(next[k]).trim() : "";
        if (!ocrOverwrite && cur) continue;

        next[k] = val;
      }

      return next;
    });

    setOcrInfo("Vorschläge übernommen. ✍️");
  }

  async function onSaveLead() {
    if (!form) return;
    if (!tenantSlug) {
      Alert.alert("Missing tenantSlug", "Please set tenantSlug in Settings.");
      return;
    }

    const missing = validateRequired();
    if (missing.length > 0) {
      Alert.alert("Missing required fields", missing.join("\n"));
      return;
    }

    if (!card?.base64) {
      Alert.alert("Visitenkarte fehlt", "Bitte zuerst eine Visitenkarte aufnehmen oder aus der Galerie wählen.");
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    const clientLeadId = pendingClientLeadId ?? (await uuidv4());
    if (!pendingClientLeadId) setPendingClientLeadId(clientLeadId);

    const meta = ocrMeta ? { ocr: ocrMeta } : undefined;

    // OFFLINE => Outbox
    if (!baseUrl || networkOnline === false) {
      try {
        await enqueueOutbox({
          id: await uuidv4(),
          createdAt: new Date().toISOString(),
          formId: form.id,
          clientLeadId,
          capturedByDeviceUid: deviceUid,
          values,
          meta,
          tries: 0,
          lastError: !baseUrl ? "No baseUrl (offline)" : "Offline (netInfo)",
          cardImageBase64: stripDataPrefix(card.base64),
          cardImageMimeType: card.mimeType,
          cardImageFilename: card.filename,
        });

        setInfo("Offline → Lead + Visitenkarte in Outbox. ⏳");
        resetValues();
        setCard(null);
        setPendingClientLeadId(null);
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      // 1) Create lead (minimal schema-safe; NO card inline)
      const created = await createLeadOnline({
        baseUrl: baseUrl!,
        tenantSlug,
        formId: form.id,
        clientLeadId,
        values,
        meta, // optional, with fallback
      });

      // 2) Upload business card as attachment (schema fallbacks)
      await uploadBusinessCardAttachmentOnline({
        baseUrl: baseUrl!,
        tenantSlug,
        leadId: created.leadId,
        filename: card.filename,
        mimeType: card.mimeType,
        base64: card.base64,
      });

      setInfo(created.usedMeta ? "Lead + Visitenkarte gespeichert. ✅" : "Lead gespeichert (meta übersprungen) + Visitenkarte ✅");
      resetValues();
      setCard(null);
      setPendingClientLeadId(null);
    } catch (e: any) {
      const queue = shouldQueueOnSaveError({ e, networkOnline, hasBaseUrl: !!baseUrl });

      if (queue) {
        const msg = getApiMessageFromError(e);

        await enqueueOutbox({
          id: await uuidv4(),
          createdAt: new Date().toISOString(),
          formId: form.id,
          clientLeadId,
          capturedByDeviceUid: deviceUid,
          values,
          meta,
          tries: 0,
          lastError: msg,
          cardImageBase64: stripDataPrefix(card.base64),
          cardImageMimeType: card.mimeType,
          cardImageFilename: card.filename,
        });

        setInfo("Temporär fehlgeschlagen → Lead in Outbox. ⏳");
        resetValues();
        setCard(null);
        setPendingClientLeadId(null);
        setError(null);
      } else {
        // Do NOT queue. Keep values + card; keep clientLeadId for safe retry.
        const status = getHttpStatusFromError(e);
        const apiCode = getApiCodeFromError(e);
        const msg = getApiMessageFromError(e);

        const extra = [apiCode ? `code=${apiCode}` : null, typeof status === "number" ? `http=${status}` : null]
          .filter(Boolean)
          .join(", ");

        setError(extra ? `${msg} (${extra})` : msg);
        setInfo("Nicht gespeichert (kein Offline-Fall). Bitte korrigieren und erneut speichern.");
      }
    } finally {
      setSaving(false);
    }
  }

  function renderField(field: MobileFormField) {
    const k = fieldKey(field);
    const label = String(field.label ?? field.key ?? "Field");
    const required = field.required === true;
    const placeholder = field.placeholder ?? "";
    const helpText = field.helpText ?? "";
    const type = field.type;

    const commonLabel = (
      <View style={{ gap: 4 }}>
        <Text style={styles.fieldLabel}>
          {label} {required ? <Text style={styles.req}>*</Text> : null}
        </Text>
        {helpText ? <Text style={styles.help}>{String(helpText)}</Text> : null}
      </View>
    );

    if (type === "CHECKBOX") {
      const v = Boolean(values[k]);
      return (
        <View key={k} style={styles.fieldCard}>
          {commonLabel}
          <View style={styles.rowBetween}>
            <Text style={styles.valueHint}>{v ? "Yes" : "No"}</Text>
            <Switch value={v} onValueChange={(nv) => setValue(k, nv)} />
          </View>
        </View>
      );
    }

    if (type === "SELECT") {
      const options = normalizeOptions(field.config ?? null);
      const v = typeof values[k] === "string" ? values[k] : "";
      return (
        <View key={k} style={styles.fieldCard}>
          {commonLabel}
          {options.length === 0 ? (
            <Text style={styles.help}>No options configured.</Text>
          ) : (
            <View style={styles.optionsWrap}>
              {options.map((opt) => {
                const selected = v === opt.value;
                return (
                  <Pressable
                    key={`${k}:${opt.value}`}
                    onPress={() => setValue(k, opt.value)}
                    style={[styles.optionChip, selected ? styles.optionChipSelected : null]}
                  >
                    <Text style={[styles.optionChipText, selected ? styles.optionChipTextSelected : null]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      );
    }

    if (type === "MULTISELECT") {
      const options = normalizeOptions(field.config ?? null);
      const cur = Array.isArray(values[k]) ? (values[k] as string[]) : [];
      return (
        <View key={k} style={styles.fieldCard}>
          {commonLabel}
          {options.length === 0 ? (
            <Text style={styles.help}>No options configured.</Text>
          ) : (
            <View style={styles.optionsWrap}>
              {options.map((opt) => {
                const selected = cur.includes(opt.value);
                return (
                  <Pressable
                    key={`${k}:${opt.value}`}
                    onPress={() => toggleMulti(k, opt.value)}
                    style={[styles.optionChip, selected ? styles.optionChipSelected : null]}
                  >
                    <Text style={[styles.optionChipText, selected ? styles.optionChipTextSelected : null]}>
                      {selected ? "✓ " : ""}
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      );
    }

    const v = values[k] ?? "";
    const keyboardType =
      type === "EMAIL"
        ? "email-address"
        : type === "PHONE"
          ? "phone-pad"
          : type === "NUMBER"
            ? "numeric"
            : type === "URL"
              ? "url"
              : "default";

    const multiline = type === "TEXTAREA";
    const autoCapitalize = type === "EMAIL" || type === "URL" ? "none" : "sentences";

    return (
      <View key={k} style={styles.fieldCard}>
        {commonLabel}
        <TextInput
          value={String(v)}
          onChangeText={(t) => setValue(k, t)}
          placeholder={placeholder ? String(placeholder) : ""}
          autoCapitalize={autoCapitalize as any}
          autoCorrect={type !== "EMAIL" && type !== "URL"}
          keyboardType={keyboardType as any}
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          style={[styles.input, multiline ? styles.textarea : null]}
        />
        {type === "DATE" || type === "DATETIME" ? (
          <Text style={styles.help}>
            Hint: enter {type === "DATE" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm"} (MVP input).
          </Text>
        ) : null}
      </View>
    );
  }

  const title = form?.name ?? formName ?? "Form";

  const extracted = ocrMeta?.extracted ?? {};
  const extractedKeys = (["email", "phone", "url", "name", "company"] as OcrFieldKey[]).filter(
    (k) => typeof (extracted as any)[k] === "string" && String((extracted as any)[k]).trim() !== ""
  );

  function labelFor(k: OcrFieldKey) {
    if (k === "email") return "E-Mail";
    if (k === "phone") return "Telefon";
    if (k === "url") return "Website";
    if (k === "name") return "Name";
    if (k === "company") return "Firma";
    return k;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <View style={styles.container}>
          <Text style={styles.h1}>Capture</Text>

          <View style={styles.topCard}>
            <Text style={styles.topTitle}>{title}</Text>
            <Text style={styles.topSub}>
              Form ID: <Text style={styles.mono}>{formId}</Text>
            </Text>
            <Text style={styles.topSub}>
              Tenant: <Text style={styles.mono}>{tenantSlug || "—"}</Text>
            </Text>

            <View style={styles.actionsRow}>
              <Pressable onPress={load} style={styles.btnGhost} disabled={!canLoad || loading}>
                <Text style={styles.btnGhostText}>{loading ? "Loading…" : "Reload"}</Text>
              </Pressable>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}
          </View>

          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {!isLoaded ? (
              <Text style={styles.hint}>Loading settings…</Text>
            ) : !tenantSlug ? (
              <Text style={styles.hint}>Please set tenantSlug in Settings first.</Text>
            ) : loading ? (
              <Text style={styles.hint}>Loading form…</Text>
            ) : !form ? (
              <Text style={styles.hint}>No form loaded.</Text>
            ) : (
              <>
                <View style={styles.cardBox}>
                  <Text style={styles.cardTitle}>Visitenkarte (Scan)</Text>
                  <Text style={styles.cardText}>
                    Online: Lead wird zuerst minimal erstellt, danach wird die Visitenkarte als Attachment hochgeladen.
                    Offline: Outbox.
                  </Text>

                  {card ? (
                    <View style={{ gap: 6 }}>
                      <Text style={styles.cardMeta}>
                        Datei: <Text style={styles.mono}>{card.filename}</Text>
                      </Text>
                      <Text style={styles.cardMeta}>
                        Zeitpunkt: <Text style={styles.mono}>{card.createdAt}</Text>
                      </Text>

                      <View style={styles.actionsRow}>
                        <Pressable onPress={removeCard} style={styles.btnDangerSmall}>
                          <Text style={styles.btnDangerSmallText}>Entfernen</Text>
                        </Pressable>

                        <Pressable
                          onPress={onOcrScan}
                          style={[styles.btnPrimary, !card || ocrBusy || cardBusy ? { opacity: 0.6 } : null]}
                          disabled={!card || ocrBusy || cardBusy}
                        >
                          <Text style={styles.btnPrimaryText}>{ocrBusy ? "OCR…" : "OCR scannen"}</Text>
                        </Pressable>
                      </View>

                      {ocrError ? <Text style={styles.error}>OCR: {ocrError}</Text> : null}
                      {ocrInfo ? <Text style={styles.info}>{ocrInfo}</Text> : null}
                    </View>
                  ) : (
                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() => pickBusinessCard("camera")}
                        style={[styles.btnPrimary, cardBusy ? { opacity: 0.6 } : null]}
                        disabled={cardBusy}
                      >
                        <Text style={styles.btnPrimaryText}>{cardBusy ? "…" : "Foto aufnehmen"}</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => pickBusinessCard("library")}
                        style={[styles.btnGhost, cardBusy ? { opacity: 0.6 } : null]}
                        disabled={cardBusy}
                      >
                        <Text style={styles.btnGhostText}>{cardBusy ? "…" : "Aus Galerie"}</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                {ocrMeta ? (
                  <View style={styles.ocrBox}>
                    <Text style={styles.ocrTitle}>OCR Vorschläge (Review)</Text>

                    {extractedKeys.length === 0 ? (
                      <Text style={styles.help}>Keine verwertbaren Vorschläge gefunden.</Text>
                    ) : (
                      <View style={{ gap: 10 }}>
                        {extractedKeys.map((k) => {
                          const v = String((extracted as any)[k] ?? "");
                          const checked = ocrApply?.[k] !== false;
                          const target = pickTargetField(k);
                          const targetLabel = target ? String(target.label ?? target.key ?? fieldKey(target)) : "—";
                          return (
                            <View key={`ocr:${k}`} style={styles.ocrRow}>
                              <View style={{ flex: 1, gap: 3 }}>
                                <Text style={styles.ocrKey}>{labelFor(k)}</Text>
                                <Text style={styles.ocrVal}>{v}</Text>
                                <Text style={styles.ocrHint}>
                                  Ziel-Feld: <Text style={styles.mono}>{targetLabel}</Text>
                                </Text>
                              </View>
                              <Switch value={!!checked} onValueChange={(nv) => setOcrApply((prev) => ({ ...prev, [k]: nv }))} />
                            </View>
                          );
                        })}

                        <View style={styles.rowBetween}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.ocrKey}>Bestehende Werte überschreiben</Text>
                            <Text style={styles.help}>Standard: nur leere Felder befüllen.</Text>
                          </View>
                          <Switch value={ocrOverwrite} onValueChange={setOcrOverwrite} />
                        </View>

                        <Pressable onPress={applyOcrToValues} style={styles.btnPrimary}>
                          <Text style={styles.btnPrimaryText}>Übernehmen</Text>
                        </Pressable>

                        {isDev() ? (
                          <View style={{ gap: 8 }}>
                            <Pressable onPress={() => setShowOcrRaw((p) => !p)} style={styles.btnGhost}>
                              <Text style={styles.btnGhostText}>
                                {showOcrRaw ? "OCR Rohtext ausblenden" : "OCR Rohtext anzeigen (DEV)"}
                              </Text>
                            </Pressable>
                            {showOcrRaw ? (
                              <View style={styles.ocrRawBox}>
                                <Text style={styles.mono}>{ocrMeta.rawText || "—"}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}

                {fields.map(renderField)}

                <View style={styles.footerCard}>
                  <Text style={styles.footerTitle}>Save Lead</Text>
                  <Text style={styles.footerText}>Online: Create Lead (minimal) + Upload Card (Attachment). Outbox: nur Offline/Transient.</Text>

                  <Pressable
                    style={[styles.btnPrimary, (saving || !card) ? { opacity: 0.6 } : null]}
                    onPress={onSaveLead}
                    disabled={saving || !card}
                  >
                    <Text style={styles.btnPrimaryText}>{saving ? "Saving…" : !card ? "Visitenkarte erforderlich" : "Save Lead"}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: "700" },

  topCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 6 },
  topTitle: { fontSize: 16, fontWeight: "800" },
  topSub: { color: "#555" },
  mono: { fontFamily: "monospace" },

  actionsRow: { marginTop: 6, flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  btnGhost: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  btnGhostText: { fontWeight: "700" },

  error: { marginTop: 6, color: "#b00020", fontWeight: "600" },
  info: { marginTop: 6, color: "#0a6", fontWeight: "700" },
  hint: { color: "#555" },

  scroll: { paddingBottom: 24, gap: 12 },

  fieldCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 10 },
  fieldLabel: { fontSize: 14, fontWeight: "800" },
  req: { color: "#b00020" },
  help: { color: "#666", fontSize: 12 },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  valueHint: { color: "#444", fontWeight: "700" },

  optionsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: { borderWidth: 1, borderColor: "#ddd", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  optionChipSelected: { backgroundColor: "#111", borderColor: "#111" },
  optionChipText: { fontWeight: "700" },
  optionChipTextSelected: { color: "#fff" },

  footerCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 8, marginTop: 8 },
  footerTitle: { fontSize: 16, fontWeight: "800" },
  footerText: { color: "#555" },

  btnPrimary: { backgroundColor: "#111", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },

  cardBox: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "900" },
  cardText: { color: "#555" },
  cardMeta: { color: "#444" },

  btnDangerSmall: { borderWidth: 1, borderColor: "#b00020", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnDangerSmallText: { color: "#b00020", fontWeight: "900" },

  ocrBox: { borderWidth: 1, borderColor: "#e7e7ea", borderRadius: 12, padding: 12, gap: 10 },
  ocrTitle: { fontSize: 16, fontWeight: "900" },
  ocrRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ocrKey: { fontWeight: "900" },
  ocrVal: { color: "#111", fontWeight: "700" },
  ocrHint: { color: "#555", fontSize: 12 },
  ocrRawBox: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, backgroundColor: "#fafafa" },
});
