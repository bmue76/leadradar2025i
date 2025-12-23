import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useNetInfo } from "@react-native-community/netinfo";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";
import { BrandMark } from "../components/BrandMark";

type LockReason = "missing_settings" | "missing_license" | "expired" | "backend_denied" | "offline";

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
      return "Keine aktive Lizenz";
    case "expired":
      return "Lizenz abgelaufen";
    case "backend_denied":
      return "Aktivierung abgelehnt";
    case "offline":
      return "Kein Internet";
  }
}

function reasonText(r: LockReason) {
  switch (r) {
    case "missing_settings":
      return "Bitte Basis-URL & Tenant in den Einstellungen setzen, damit die App aktiviert werden kann.";
    case "missing_license":
      return "Keine aktive Lizenz gefunden. Bitte Lizenz aktivieren.";
    case "expired":
      return "Lizenz ist abgelaufen. Bitte verlängern oder erneut aktivieren.";
    case "backend_denied":
      return "Die Aktivierung wurde vom Backend abgelehnt. Bitte erneut aktivieren oder Einstellungen prüfen.";
    case "offline":
      return "Kein Internet – bitte verbinden und erneut versuchen.";
  }
}

export default function StartScreen() {
  const nav = useNavigation<any>();
  const net = useNetInfo();
  const settings = useSettings();
  const activation = useActivation();

  const [refreshing, setRefreshing] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  const online = !!(net.isConnected && net.isInternetReachable !== false);

  const hasSettings = useMemo(() => Boolean(settings.baseUrl && settings.tenantSlug), [settings.baseUrl, settings.tenantSlug]);

  const hasDenied = useMemo(
    () => Boolean(activation.lastDeniedCode || activation.lastDeniedMessage),
    [activation.lastDeniedCode, activation.lastDeniedMessage]
  );

  // Avoid “flash” when gate is switching to unlocked
  const isUnlocking = useMemo(() => hasSettings && activation.isActiveNow, [hasSettings, activation.isActiveNow]);

  const lockReason = useMemo<LockReason>(() => {
    if (!hasSettings) return "missing_settings";
    if (!online) return "offline";
    if (activation.active && activation.expiresAt && !activation.isActiveNow) return "expired";
    if (hasDenied) return "backend_denied";
    return "missing_license";
  }, [hasSettings, online, activation.active, activation.expiresAt, activation.isActiveNow, hasDenied]);

  const deniedCodeLine = useMemo(() => {
    if (!activation.lastDeniedCode) return null;
    return `Code: ${activation.lastDeniedCode}`;
  }, [activation.lastDeniedCode]);

  const deniedMsgLine = useMemo(() => {
    if (!activation.lastDeniedMessage) return null;
    return activation.lastDeniedMessage;
  }, [activation.lastDeniedMessage]);

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.allSettled([settings.refresh(), activation.refresh()]);
      // RootNavigator übernimmt das Umschalten, sobald valid/unlocked.
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, settings, activation]);

  const disableNav = refreshing || isUnlocking;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.wrap}>
        <View style={styles.brandBlock}>
          <BrandMark variant="combo" size="md" />
          <Text style={styles.sub}>Mobile Lead Capture</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.statusLabel}>STATUS</Text>

          {isUnlocking ? (
            <>
              <Text style={styles.statusTitle}>Wird geöffnet…</Text>
              <View style={styles.busyRow}>
                <ActivityIndicator color="white" />
                <Text style={styles.statusText}>Lizenz ist aktiv. App startet…</Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.statusTitle}>{reasonTitle(lockReason)}</Text>
              <Text style={styles.statusText}>{reasonText(lockReason)}</Text>

              {lockReason === "backend_denied" ? (
                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle}>Details</Text>
                  {deniedMsgLine ? <Text style={styles.detailText}>{deniedMsgLine}</Text> : null}
                  {deniedCodeLine ? <Text style={styles.detailMono}>{deniedCodeLine}</Text> : null}
                  {activation.lastDeniedAt ? (
                    <Text style={styles.detailMono}>Zeit: {fmtDate(activation.lastDeniedAt)}</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          )}

          {!online && hasSettings ? (
            <View style={styles.offlineBox}>
              <Text style={styles.offlineTitle}>Hinweis</Text>
              <Text style={styles.offlineText}>Aktivierung/Refresh benötigt Internet.</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, styles.btnGhost, (refreshing || isUnlocking) && styles.btnDisabled]}
            onPress={onRefresh}
            disabled={refreshing || isUnlocking}
          >
            {refreshing ? (
              <View style={styles.btnBusyRow}>
                <ActivityIndicator color="#e2e8f0" />
                <Text style={styles.btnGhostText}>Aktualisieren…</Text>
              </View>
            ) : (
              <Text style={styles.btnGhostText}>Erneut versuchen / Aktualisieren</Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnPrimary, disableNav && styles.btnDisabled]}
            onPress={() => nav.navigate("Activation")}
            disabled={disableNav}
          >
            <Text style={styles.btnPrimaryText}>Lizenz aktivieren</Text>
          </Pressable>

          <Pressable
            style={[styles.btn, styles.btnGhost, disableNav && styles.btnDisabled]}
            onPress={() => nav.navigate("Settings")}
            disabled={disableNav}
          >
            <Text style={styles.btnGhostText}>Einstellungen</Text>
          </Pressable>
        </View>

        {__DEV__ ? (
          <View style={styles.devCard}>
            <Pressable onPress={() => setDevOpen((v) => !v)} style={styles.devHeader}>
              <Text style={styles.devTitle}>DEV DETAILS</Text>
              <Text style={styles.devToggle}>{devOpen ? "▲" : "▼"}</Text>
            </Pressable>

            {devOpen ? (
              <>
                <Line k="online" v={String(online)} />
                <Line k="hasSettings" v={String(hasSettings)} />
                <Line k="baseUrl" v={settings.baseUrl || "—"} mono />
                <Line k="tenantSlug" v={settings.tenantSlug || "—"} mono />
                <Line k="active" v={String(activation.active)} />
                <Line k="isActiveNow" v={String(activation.isActiveNow)} />
                <Line k="expiresAt" v={fmtDate(activation.expiresAt)} mono />
                <Line k="keyLast4" v={activation.keyLast4 ?? "—"} mono />
                <Line k="licenseKeyId" v={activation.licenseKeyId ?? "—"} mono />
                <Line k="lastDeniedCode" v={activation.lastDeniedCode ?? "—"} mono />
                <Line k="lastDeniedAt" v={fmtDate(activation.lastDeniedAt)} mono />
                <Line k="reason" v={lockReason} mono />
              </>
            ) : null}
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

  brandBlock: { alignItems: "center", gap: 8 },
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

  busyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },

  detailBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#0b1220",
    gap: 6,
  },
  detailTitle: { color: "#e2e8f0", fontWeight: "900" },
  detailText: { color: "#cbd5e1" },
  detailMono: { color: "#e2e8f0", fontFamily: "monospace", fontWeight: "700" },

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

  btnBusyRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  btnDisabled: { opacity: 0.6 },

  devCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#243041",
    backgroundColor: "#0b1220",
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  devHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  devTitle: { color: "#93a4b8", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  devToggle: { color: "#93a4b8", fontSize: 12, fontWeight: "900" },

  line: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  k: { color: "#93a4b8", fontSize: 12 },
  v: { color: "#e2e8f0", fontSize: 12, fontWeight: "800", flex: 1, textAlign: "right" },
  mono: { fontFamily: "monospace", fontWeight: "600" },
});
