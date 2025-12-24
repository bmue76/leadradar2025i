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

import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

import type { RootStackParamList } from "../navigation/types";
import { useSettings } from "../storage/SettingsContext";
import { mobileGetJson, mobilePostJson } from "../lib/mobileApi";
import { uuidv4 } from "../lib/uuid";
import { enqueueOutbox } from "../storage/outbox";
import { loadFormDetailCache, saveFormDetailCache } from "../storage/formsCache";
import { DEMO_FORM_ID, getDemoFormDetail } from "../lib/demoForms";

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
  // Expo SDK / typings differ: EncodingType might not exist in TS,
  // but runtime may still provide it. Fallback to string literal.
  return ((FileSystem as any).EncodingType?.Base64 ?? "base64") as any;
}

async function readBase64FromUri(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: getBase64EncodingValue(),
  } as any);
  return String(b64 || "");
}

export default function CaptureScreen() {
  const route = useRoute<R>();
  const { formId, formName } = route.params;

  const { isLoaded, baseUrl, tenantSlug, deviceUid } = useSettings();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [form, setForm] = useState<MobileFormDetail | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});

  // Card required (base64)
  const [card, setCard] = useState<PendingCard | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  const canLoad = useMemo(() => isLoaded && !!tenantSlug && !!formId, [isLoaded, tenantSlug, formId]);

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
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.35,
              allowsEditing: false,
              exif: false,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      const base64 = await readBase64FromUri(finalUri);

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

      setInfo("Visitenkarte bereit (Base64). Wird beim Speichern mitgesendet. ✅");
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Visitenkarte konnte nicht erfasst werden.");
    } finally {
      setCardBusy(false);
    }
  }

  async function removeCard() {
    setCard(null);
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

    const clientLeadId = await uuidv4();

    const body = {
      formId: form.id,
      clientLeadId,
      values,
      capturedByDeviceUid: deviceUid,
      cardImageBase64: card.base64,
      cardImageMimeType: card.mimeType,
      cardImageFilename: card.filename,
    };

    try {
      if (!baseUrl) throw new Error("No baseUrl");

      await mobilePostJson({
        baseUrl,
        tenantSlug,
        path: "/api/mobile/v1/leads",
        timeoutMs: 15000,
        body,
      });

      setInfo("Lead + Visitenkarte gespeichert. ✅");
      resetValues();
      setCard(null);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Save failed, queued.";

      await enqueueOutbox({
        id: await uuidv4(),
        createdAt: new Date().toISOString(),
        formId: form.id,
        clientLeadId,
        capturedByDeviceUid: deviceUid,
        values,
        tries: 0,
        lastError: msg,
        cardImageBase64: card.base64,
        cardImageMimeType: card.mimeType,
        cardImageFilename: card.filename,
      });

      setInfo("Offline/failed → Lead + Visitenkarte in Outbox. ⏳");
      resetValues();
      setCard(null);
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
                    Prozess: Bei jedem Lead wird ein Visitenkarten-Abbild mitgesendet (MVP: komprimiertes JPG als Base64
                    im Lead-Create).
                  </Text>

                  {card ? (
                    <View style={{ gap: 6 }}>
                      <Text style={styles.cardMeta}>
                        Datei: <Text style={styles.mono}>{card.filename}</Text>
                      </Text>
                      <Text style={styles.cardMeta}>
                        Zeitpunkt: <Text style={styles.mono}>{card.createdAt}</Text>
                      </Text>
                      <Text style={styles.cardMeta}>
                        Status: <Text style={styles.mono}>bereit</Text>
                      </Text>

                      <View style={styles.actionsRow}>
                        <Pressable onPress={removeCard} style={styles.btnDangerSmall}>
                          <Text style={styles.btnDangerSmallText}>Entfernen</Text>
                        </Pressable>
                      </View>
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

                {fields.map(renderField)}

                <View style={styles.footerCard}>
                  <Text style={styles.footerTitle}>Save Lead</Text>
                  <Text style={styles.footerText}>
                    Online: JSON Lead + cardImageBase64. Offline/fail: queued to Outbox (inkl. Base64).
                  </Text>

                  <Pressable
                    style={[styles.btnPrimary, (saving || !card) ? { opacity: 0.6 } : null]}
                    onPress={onSaveLead}
                    disabled={saving || !card}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {saving ? "Saving…" : !card ? "Visitenkarte erforderlich" : "Save Lead"}
                    </Text>
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

  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
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
});
