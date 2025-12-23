import React, { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSettings } from "../storage/SettingsContext";
import { useActivation } from "../storage/ActivationContext";
import { BrandMark } from "../components/BrandMark";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString();
}

export default function SettingsScreen() {
  const settings = useSettings();
  const activation = useActivation();

  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [tenantSlug, setTenantSlug] = useState(settings.tenantSlug);

  useEffect(() => {
    setBaseUrl(settings.baseUrl);
    setTenantSlug(settings.tenantSlug);
  }, [settings.baseUrl, settings.tenantSlug]);

  const licenseStatus = useMemo(() => {
    if (activation.isActiveNow) return "ACTIVE";
    if (activation.active && activation.expiresAt) return "EXPIRED";
    if (activation.active) return "BLOCKED";
    return "NOT ACTIVE";
  }, [activation.isActiveNow, activation.active, activation.expiresAt]);

  const onSave = async () => {
    try {
      await settings.updateSettings({ baseUrl, tenantSlug });
      Alert.alert("Saved", "Settings gespeichert.");
    } catch {
      // updateSettings handled Alerts already
    }
  };

  const onReload = async () => {
    await settings.refresh();
    Alert.alert("Reloaded", "Settings neu geladen.");
  };

  const onKillLicense = () => {
    Alert.alert(
      "Lizenz killen (DEV)",
      "Willst du die lokale Lizenz-Aktivierung wirklich löschen?\n\nDanach wird die App wieder gesperrt (Activation Screen).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await activation.clear();
              Alert.alert("OK", "Lizenz gelöscht. App ist jetzt gesperrt.");
            })();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <BrandMark variant="combo" size="md" />
          <Text style={styles.h1}>Settings</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Device UID</Text>
          <Text style={styles.mono}>{settings.deviceUid || "—"}</Text>

          <Text style={[styles.label, { marginTop: 10 }]}>Lizenz Status</Text>
          <Text style={styles.mono}>{licenseStatus}</Text>

          <Text style={[styles.label, { marginTop: 10 }]}>Expires</Text>
          <Text style={styles.mono}>{fmtDate(activation.expiresAt)}</Text>

          <Text style={[styles.label, { marginTop: 10 }]}>Key last4</Text>
          <Text style={styles.mono}>{activation.keyLast4 ?? "—"}</Text>
        </View>

        <Text style={styles.label}>Base URL</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://<LAN-IP>:3000"
          placeholderTextColor="#65758b"
          style={styles.input}
        />

        <Text style={styles.label}>Tenant Slug</Text>
        <TextInput
          value={tenantSlug}
          onChangeText={setTenantSlug}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="your-tenant"
          placeholderTextColor="#65758b"
          style={styles.input}
        />

        <View style={styles.actionsRow}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={onSave}>
            <Text style={styles.btnPrimaryText}>Save</Text>
          </Pressable>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onReload}>
            <Text style={styles.btnGhostText}>{settings.isLoaded ? "Reload" : "Loading…"}</Text>
          </Pressable>
        </View>

        <View style={styles.devBox}>
          <Text style={styles.devTitle}>DEV</Text>
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={onKillLicense}>
            <Text style={styles.btnDangerText}>Lizenz killen</Text>
          </Pressable>
          <Text style={styles.foot}>
            Löscht AsyncStorage-Key <Text style={styles.monoInline}>lr:activation</Text> und sperrt die App wieder.
          </Text>
        </View>

        <View style={styles.footerBrand}>
          <BrandMark variant="icon" size="sm" showText={false} />
          <Text style={styles.footerText}>LeadRadar</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "white" },
  wrap: { flex: 1, padding: 16, gap: 10 },

  header: { gap: 8, paddingTop: 4 },
  h1: { fontSize: 28, fontWeight: "800" },

  card: { borderWidth: 1, borderColor: "#e7e7ea", borderRadius: 12, padding: 12, backgroundColor: "#fafafa" },
  label: { fontSize: 12, color: "#667085" },
  mono: { fontFamily: "monospace", fontSize: 13, color: "#111827" },
  monoInline: { fontFamily: "monospace" },

  input: { borderWidth: 1, borderColor: "#d0d5dd", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },

  actionsRow: { marginTop: 12, flexDirection: "row", gap: 10, flexWrap: "wrap" },

  btn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, alignItems: "center" },
  btnPrimary: { backgroundColor: "#111827" },
  btnPrimaryText: { color: "white", fontWeight: "800" },

  btnGhost: { borderWidth: 1, borderColor: "#d0d5dd" },
  btnGhostText: { color: "#111827", fontWeight: "800" },

  devBox: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#eef2f7", gap: 10 },
  devTitle: { fontSize: 12, fontWeight: "900", color: "#667085", letterSpacing: 1 },

  btnDanger: { borderWidth: 1, borderColor: "#fca5a5" },
  btnDangerText: { color: "#b91c1c", fontWeight: "900" },

  foot: { fontSize: 12, color: "#667085" },

  footerBrand: { marginTop: 18, flexDirection: "row", alignItems: "center", gap: 8, opacity: 0.55 },
  footerText: { fontSize: 12, fontWeight: "800" },
});
