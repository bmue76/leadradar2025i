import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useNetInfo } from "@react-native-community/netinfo";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";

type LockReason =
  | "missing_settings"
  | "missing_license"
  | "expired"
  | "backend_denied";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString();
}

function reasonTitle(r: LockReason) {
  switch (r) {
    case "missing_settings":
      return "Einrichtung fehlt";
    case "missing_license":
      return "Keine gültige Lizenz";
    case "expired":
      return "Lizenz abgelaufen";
    case "backend_denied":
      return "Lizenz nicht gültig";
  }
}

function reasonText(r: LockReason) {
  switch (r) {
    case "missing_settings":
      return "Bitte baseUrl und tenantSlug in den Einstellungen setzen, damit die App aktiviert werden kann.";
    case "missing_license":
      return "Diese App ist noch nicht aktiviert. Bitte Lizenz aktivieren.";
    case "expired":
      return "Die Lizenz ist abgelaufen. Bitte verlängern oder erneut aktivieren.";
    case "backend_denied":
      return "Die Lizenz wurde abgelehnt oder ist nicht mehr gültig. Bitte erneut aktivieren oder Support kontaktieren.";
  }
}

export default function StartScreen() {
  const nav = useNavigation<any>();
  const net = useNetInfo();
  const settings = useSettings();
  const activation = useActivation();

  const online = !!(net.isConnected && net.isInternetReachable !== false);

  const hasSettings = useMemo(() => {
    return Boolean(settings.baseUrl && settings.tenantSlug);
  }, [settings.baseUrl, settings.tenantSlug]);

  const lockReason = useMemo<LockReason>(() => {
    if (!hasSettings) return "missing_settings";
    if (!activation.active) return "missing_license";
    if (activation.active && activation.expiresAt && !activation.isActiveNow) return "expired";
    // fallback: wenn active=false wird oben abgefangen; wenn active=true aber isActiveNow trotzdem false -> denied/unknown
    return "backend_denied";
  }, [hasSettings, activation.active, activation.expiresAt, activation.isActiveNow]);

  const showOfflineHint = useMemo(() => {
    // Offline ist “relevant”, wenn Settings vorhanden sind (dann würde Aktivierung/Sync online gehen)
    return hasSettings && !online;
  }, [hasSettings, online]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.wrap}>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>LEADRADAR</Text>
          <Text style={styles.sub}>Mobile Lead Capture</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.statusLabel}>STATUS</Text>
          <Text style={styles.statusTitle}>{reasonTitle(lockReason)}</Text>
          <Text style={styles.statusText}>{reasonText(lockReason)}</Text>

          {showOfflineHint ? (
            <View style={styles.offlineBox}>
              <Text style={styles.offlineTitle}>Offline</Text>
              <Text style={styles.offlineText}>
                Du bist aktuell offline. Aktivierung benötigt Internet.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => nav.navigate("Activation")}>
            <Text style={styles.btnPrimaryText}>Lizenz aktivieren</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => nav.navigate("Settings")}>
            <Text style={styles.btnGhostText}>Einstellungen</Text>
          </Pressable>
        </View>

        {__DEV__ ? (
          <View style={styles.devCard}>
            <Text style={styles.devTitle}>DEV DEBUG</Text>
            <Line k="online" v={String(online)} />
            <Line k="hasSettings" v={String(hasSettings)} />
            <Line k="baseUrl" v={settings.baseUrl || "—"} mono />
            <Line k="tenantSlug" v={settings.tenantSlug || "—"} mono />
            <Line k="active" v={String(activation.active)} />
            <Line k="isActiveNow" v={String(activation.isActiveNow)} />
            <Line k="expiresAt" v={fmtDate(activation.expiresAt)} mono />
            <Line k="keyLast4" v={activation.keyLast4 ?? "—"} mono />
            <Line k="licenseKeyId" v={activation.licenseKeyId ?? "—"} mono />
            <Line k="reason" v={lockReason} mono />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Line({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, mono ? styles.mono : null]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0f14" },
  wrap: { flex: 1, padding: 16, gap: 14, justifyContent: "center" },

  brandBlock: { alignItems: "center", gap: 6 },
  brand: { fontSize: 34, fontWeight: "900", color: "white", letterSpacing: 1 },
  sub: { color: "#b8c0cc", fontSize: 13, fontWeight: "700" },

  card: {
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  statusLabel: { color: "#93a4b8", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  statusTitle: { color: "white", fontSize: 20, fontWeight: "900" },
  statusText: { color: "#cbd5e1", fontSize: 14, lineHeight: 20 },

  offlineBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#0b1220",
    gap: 4,
  },
  offlineTitle: { color: "#e2e8f0", fontWeight: "900" },
  offlineText: { color: "#cbd5e1" },

  actions: { gap: 10 },
  btn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: "center" },
  btnPrimary: { backgroundColor: "#111827" },
  btnPrimaryText: { color: "white", fontWeight: "900" },
  btnGhost: { borderWidth: 1, borderColor: "#334155" },
  btnGhostText: { color: "#e2e8f0", fontWeight: "900" },

  devCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#243041",
    backgroundColor: "#0b1220",
    borderRadius: 14,
    padding: 12,
    gap: 6,
  },
  devTitle: { color: "#93a4b8", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  k: { color: "#93a4b8", fontSize: 12 },
  v: { color: "#e2e8f0", fontSize: 12, fontWeight: "800", flex: 1, textAlign: "right" },
  mono: { fontFamily: "monospace", fontWeight: "600" },
});
