import React, { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";

type ApiErr = { code?: string; message?: string };

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString();
}

function friendlyMessage(code?: string, fallback?: string) {
  switch (code) {
    case "PAYMENT_PENDING":
      return "Zahlung ausstehend. Bitte Zahlung/Verlängerung abschliessen und danach erneut aktivieren.";
    case "KEY_ALREADY_BOUND":
      return "Dieser Aktivierungscode ist bereits an ein anderes Gerät gebunden (1 Key = 1 Device).";
    case "LICENSE_EXPIRED":
      return "Lizenz abgelaufen. Bitte verlängern oder einen neuen Aktivierungscode verwenden.";
    case "TENANT_REQUIRED":
      return "Mandant fehlt. Bitte tenantSlug in den Settings setzen.";
    case "TENANT_NOT_FOUND":
      return "Mandant nicht gefunden. Bitte tenantSlug prüfen.";
    default:
      return fallback || "Aktivierung fehlgeschlagen. Bitte prüfen und erneut versuchen.";
  }
}

function pickError(json: any): ApiErr {
  const e = json?.error ?? json?.err ?? json;
  return {
    code: typeof e?.code === "string" ? e.code : undefined,
    message: typeof e?.message === "string" ? e.message : undefined,
  };
}

function pickSuccess(json: any): { status?: string; expiresAt?: string; licenseKeyId?: string } {
  const d = json?.data ?? json;
  return {
    status: typeof d?.status === "string" ? d.status : undefined,
    expiresAt: typeof d?.expiresAt === "string" ? d.expiresAt : undefined,
    licenseKeyId: typeof d?.licenseKeyId === "string" ? d.licenseKeyId : undefined,
  };
}

export default function ActivationScreen() {
  const nav = useNavigation<any>();
  const settings = useSettings();
  const activation = useActivation();

  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<{ code?: string; message: string } | null>(null);

  const status = useMemo(() => {
    if (activation.isActiveNow) return "ACTIVE";
    if (activation.active && activation.expiresAt) return "EXPIRED";
    if (activation.active) return "BLOCKED";
    return "NOT ACTIVE";
  }, [activation.isActiveNow, activation.active, activation.expiresAt]);

  const canActivate = useMemo(() => {
    return (
      !busy &&
      settings.isLoaded &&
      activation.isLoaded &&
      Boolean(settings.baseUrl) &&
      Boolean(settings.tenantSlug)
    );
  }, [busy, settings.isLoaded, activation.isLoaded, settings.baseUrl, settings.tenantSlug]);

  const onActivate = async () => {
    setLastError(null);

    const key = licenseKey.trim();
    if (!key) {
      Alert.alert("Aktivierungscode fehlt", "Bitte Aktivierungscode eingeben.");
      return;
    }
    if (!settings.tenantSlug) {
      Alert.alert("tenantSlug fehlt", "Bitte zuerst in Settings den tenantSlug setzen.");
      nav.navigate("Settings");
      return;
    }
    if (!settings.baseUrl) {
      Alert.alert("baseUrl fehlt", "Bitte zuerst in Settings die baseUrl setzen.");
      nav.navigate("Settings");
      return;
    }
    if (!settings.deviceUid) {
      Alert.alert("Device UID fehlt", "Device UID ist noch nicht bereit. Bitte App neu starten.");
      return;
    }

    setBusy(true);
    try {
      const url = `${settings.baseUrl}/api/mobile/v1/activate`;
      const body = {
        licenseKey: key,
        deviceUid: settings.deviceUid,
        platform: Platform.OS,
        appVersion: "dev",
        osVersion: String(Platform.Version),
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-slug": settings.tenantSlug,
        },
        body: JSON.stringify(body),
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (!res.ok) {
        const e = pickError(json);
        const msg = friendlyMessage(e.code, e.message || `HTTP ${res.status}`);
        setLastError({ code: e.code, message: msg });
        Alert.alert("Aktivierung fehlgeschlagen", msg + (e.code ? `\n\nCode: ${e.code}` : ""));
        return;
      }

      const ok = pickSuccess(json);
      const isActive = ok.status === "ACTIVE" || ok.status === "active" || ok.status === "ACTIVE_OK";
      const expiresAt = ok.expiresAt ?? null;
      const keyLast4 = key.replace(/\s+/g, "").slice(-4).toUpperCase();

      await activation.applyActivation({
        active: isActive,
        expiresAt,
        keyLast4,
        licenseKeyId: ok.licenseKeyId ?? null,
      });

      Alert.alert("Aktiviert", `Lizenz ist aktiv.\nGültig bis: ${fmtDate(expiresAt)}`);
      // RootNavigator switcht automatisch, sobald activation.isActiveNow true ist.
    } catch {
      const msg = "Keine Verbindung / Request fehlgeschlagen. Bitte Netzwerk & baseUrl prüfen.";
      setLastError({ message: msg });
      Alert.alert("Aktivierung fehlgeschlagen", msg);
    } finally {
      setBusy(false);
    }
  };

  const onDemo60 = async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await activation.applyActivation({
      active: true,
      expiresAt,
      keyLast4: "DEMO",
      licenseKeyId: "demo-60m",
    });
    Alert.alert("Demo aktiv", `Demo ist aktiv bis: ${fmtDate(expiresAt)}`);
  };

  const onClear = async () => {
    await activation.clear();
    Alert.alert("Deaktiviert", "Lokale Aktivierung wurde gelöscht. App bleibt gesperrt.");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <Text style={styles.h1}>Activation</Text>

        <View style={styles.card}>
          <Row label="Status" value={status} />
          <Row label="Expires" value={fmtDate(activation.expiresAt)} />
          <Row label="Key last4" value={activation.keyLast4 ?? "—"} />
          <Row label="Tenant" value={settings.tenantSlug || "—"} />
          <Row
            label="Device"
            value={settings.deviceUid ? settings.deviceUid.slice(0, 12) + "…" : "—"}
            mono
          />
        </View>

        <Text style={styles.label}>License key</Text>
        <TextInput
          value={licenseKey}
          onChangeText={setLicenseKey}
          autoCapitalize="characters"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          placeholderTextColor="#65758b"
          style={styles.input}
        />

        <Pressable
          style={[styles.btn, styles.btnPrimary, !canActivate && styles.btnDisabled]}
          onPress={onActivate}
          disabled={!canActivate}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="white" />
              <Text style={styles.btnPrimaryText}>Activating…</Text>
            </View>
          ) : (
            <Text style={styles.btnPrimaryText}>Activate</Text>
          )}
        </Pressable>

        {lastError ? (
          <View style={styles.errBox}>
            <Text style={styles.errTitle}>Fehler</Text>
            <Text style={styles.errText}>{lastError.message}</Text>
            {lastError.code ? <Text style={styles.errCode}>Code: {lastError.code}</Text> : null}
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => nav.navigate("Settings")}>
            <Text style={styles.btnGhostText}>Open Settings</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onDemo60}>
            <Text style={styles.btnGhostText}>Demo 60 min</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnDanger]} onPress={onClear}>
            <Text style={styles.btnDangerText}>Deactivate / Clear (DEV)</Text>
          </Pressable>
        </View>

        <Text style={styles.foot}>
          POST /api/mobile/v1/activate · Header: x-tenant-slug · Body: licenseKey, deviceUid, platform, appVersion, osVersion
        </Text>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.labelSmall}>{label}</Text>
      <Text style={[styles.value, mono && styles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "white" },
  wrap: { flex: 1, padding: 16, gap: 10 },
  h1: { fontSize: 28, fontWeight: "800" },

  card: {
    borderWidth: 1,
    borderColor: "#e7e7ea",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fafafa",
    gap: 8,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  labelSmall: { fontSize: 12, color: "#667085" },
  value: { fontSize: 13, color: "#111827", fontWeight: "700", flex: 1, textAlign: "right" },
  mono: { fontFamily: "monospace", fontWeight: "500" },

  label: { fontSize: 12, color: "#667085" },
  input: {
    borderWidth: 1,
    borderColor: "#d0d5dd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "monospace",
  },

  btn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, alignItems: "center" },
  btnPrimary: { backgroundColor: "#111827" },
  btnPrimaryText: { color: "white", fontWeight: "800" },
  btnDisabled: { opacity: 0.5 },

  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  actionsRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  btnGhost: { borderWidth: 1, borderColor: "#d0d5dd" },
  btnGhostText: { color: "#111827", fontWeight: "800" },

  btnDanger: { borderWidth: 1, borderColor: "#fca5a5" },
  btnDangerText: { color: "#b91c1c", fontWeight: "900" },

  errBox: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff1f2",
    padding: 12,
    borderRadius: 12,
  },
  errTitle: { fontWeight: "900", color: "#9f1239", marginBottom: 4 },
  errText: { color: "#9f1239" },
  errCode: { marginTop: 6, fontFamily: "monospace", color: "#9f1239" },

  foot: { marginTop: 6, fontSize: 12, color: "#667085" },
});
