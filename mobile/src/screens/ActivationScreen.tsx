import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";
import { BrandMark } from "../components/BrandMark";

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
      return "Zahlung ausstehend. Bitte Verlängerung abschliessen und danach erneut aktivieren.";
    case "KEY_ALREADY_BOUND":
      return "Dieser Aktivierungscode ist bereits an ein anderes Gerät gebunden (1 Key = 1 Device).";
    case "LICENSE_EXPIRED":
      return "Lizenz abgelaufen. Bitte verlängern oder neuen Aktivierungscode verwenden.";
    case "TENANT_REQUIRED":
      return "Tenant fehlt. Bitte in den Settings den Tenant setzen.";
    case "TENANT_NOT_FOUND":
      return "Tenant nicht gefunden. Bitte Tenant prüfen.";
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
      Boolean(settings.tenantSlug) &&
      Boolean(settings.deviceUid)
    );
  }, [busy, settings.isLoaded, activation.isLoaded, settings.baseUrl, settings.tenantSlug, settings.deviceUid]);

  const onActivate = async () => {
    setLastError(null);

    const key = licenseKey.trim();
    if (!key) {
      Alert.alert("Aktivierungscode fehlt", "Bitte Aktivierungscode eingeben.");
      return;
    }
    if (!settings.tenantSlug) {
      Alert.alert("Tenant fehlt", "Bitte zuerst in Settings den Tenant setzen.");
      nav.navigate("Settings");
      return;
    }
    if (!settings.baseUrl) {
      Alert.alert("Basis-URL fehlt", "Bitte zuerst in Settings die Basis-URL setzen.");
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

        // Persist denied info so StartScreen can show "backend_denied"
        await activation.setDenied({ code: e.code ?? null, message: msg });

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

      // extra-robust: ensure denied is cleared after success
      await activation.clearDenied();

      Alert.alert("Aktiviert", `Lizenz ist aktiv.\nGültig bis: ${fmtDate(expiresAt)}`);
      // RootNavigator switcht automatisch, sobald activation.isActiveNow true ist.
    } catch {
      const msg = "Keine Verbindung / Request fehlgeschlagen. Bitte Netzwerk & Basis-URL prüfen.";
      setLastError({ message: msg });
      Alert.alert("Aktivierung fehlgeschlagen", msg);
    } finally {
      setBusy(false);
    }
  };

  const onDemo60 = async () => {
    if (busy) return;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await activation.applyActivation({
      active: true,
      expiresAt,
      keyLast4: "DEMO",
      licenseKeyId: "demo-60m",
    });
    await activation.clearDenied();
    Alert.alert("Demo aktiv", `Demo ist aktiv bis: ${fmtDate(expiresAt)}`);
  };

  const onClear = async () => {
    if (busy) return;
    await activation.clear();
    Alert.alert("Deaktiviert", "Lokale Aktivierung wurde gelöscht. App bleibt gesperrt.");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <BrandMark variant="combo" size="md" />
          <Text style={styles.h1}>Aktivierung</Text>
        </View>

        <View style={styles.card}>
          <Row label="Status" value={status} />
          <Row label="Gültig bis" value={fmtDate(activation.expiresAt)} />
          <Row label="Key last4" value={activation.keyLast4 ?? "—"} mono />
          <Row label="Tenant" value={settings.tenantSlug || "—"} mono />
          <Row label="Device" value={settings.deviceUid ? settings.deviceUid.slice(0, 12) + "…" : "—"} mono />
        </View>

        <Text style={styles.label}>Aktivierungscode</Text>
        <TextInput
          value={licenseKey}
          onChangeText={setLicenseKey}
          autoCapitalize="characters"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          placeholderTextColor="#65758b"
          style={[styles.input, busy && styles.inputDisabled]}
          editable={!busy}
        />

        <Pressable
          style={[styles.btn, styles.btnPrimary, !canActivate && styles.btnDisabled]}
          onPress={onActivate}
          disabled={!canActivate}
        >
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color="white" />
              <Text style={styles.btnPrimaryText}>Aktivieren…</Text>
            </View>
          ) : (
            <Text style={styles.btnPrimaryText}>Lizenz aktivieren</Text>
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
          <Pressable
            style={[styles.btn, styles.btnGhost, busy && styles.btnDisabled]}
            onPress={() => nav.navigate("Settings")}
            disabled={busy}
          >
            <Text style={styles.btnGhostText}>Einstellungen</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost, busy && styles.btnDisabled]} onPress={onDemo60} disabled={busy}>
            <Text style={styles.btnGhostText}>Demo 60 min</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnDanger, busy && styles.btnDisabled]} onPress={onClear} disabled={busy}>
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
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "white" },
  wrap: { flex: 1, padding: 16, gap: 12 },

  top: { gap: 8, paddingTop: 4 },
  h1: { fontSize: 26, fontWeight: "900" },

  card: { borderWidth: 1, borderColor: "#e7e7ea", borderRadius: 12, padding: 12, backgroundColor: "#fafafa", gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 12, color: "#667085" },
  rowValue: { fontSize: 12, fontWeight: "800", color: "#111827", flex: 1, textAlign: "right" },
  mono: { fontFamily: "monospace", fontWeight: "700" },

  label: { fontSize: 12, color: "#667085" },
  input: { borderWidth: 1, borderColor: "#d0d5dd", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  inputDisabled: { opacity: 0.7 },

  btn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, alignItems: "center" },
  btnPrimary: { backgroundColor: "#111827" },
  btnPrimaryText: { color: "white", fontWeight: "900" },

  btnGhost: { borderWidth: 1, borderColor: "#d0d5dd" },
  btnGhostText: { color: "#111827", fontWeight: "900" },

  btnDanger: { borderWidth: 1, borderColor: "#fca5a5" },
  btnDangerText: { color: "#b91c1c", fontWeight: "900" },

  btnDisabled: { opacity: 0.55 },

  busyRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  actionsRow: { marginTop: 6, flexDirection: "row", gap: 10, flexWrap: "wrap" },

  errBox: { borderWidth: 1, borderColor: "#fecaca", borderRadius: 12, padding: 10, backgroundColor: "#fff1f2", gap: 4 },
  errTitle: { fontWeight: "900", color: "#991b1b" },
  errText: { color: "#7f1d1d" },
  errCode: { color: "#7f1d1d", fontFamily: "monospace", fontWeight: "700" },

  foot: { marginTop: 8, fontSize: 12, color: "#667085" },
});
