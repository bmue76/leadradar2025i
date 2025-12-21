import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSettings } from "../storage/SettingsContext";

export default function SettingsScreen() {
  const { isLoaded, baseUrl, tenantSlug, deviceUid, updateSettings, refresh } = useSettings();

  const [baseUrlDraft, setBaseUrlDraft] = useState(baseUrl);
  const [tenantSlugDraft, setTenantSlugDraft] = useState(tenantSlug);

  useEffect(() => setBaseUrlDraft(baseUrl), [baseUrl]);
  useEffect(() => setTenantSlugDraft(tenantSlug), [tenantSlug]);

  async function onSave() {
    await updateSettings({ baseUrl: baseUrlDraft, tenantSlug: tenantSlugDraft });
    Alert.alert("Saved", "Settings stored locally.");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>Settings</Text>

        {!isLoaded ? (
          <Text style={styles.hint}>Loading settings…</Text>
        ) : (
          <>
            <Text style={styles.label}>Base URL</Text>
            <TextInput
              value={baseUrlDraft}
              onChangeText={setBaseUrlDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://<LAN-IP>:3000"
              style={styles.input}
            />

            <Text style={styles.label}>Tenant Slug (required)</Text>
            <TextInput
              value={tenantSlugDraft}
              onChangeText={setTenantSlugDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. my-company"
              style={styles.input}
            />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Device UID</Text>
              <Text style={styles.mono}>{deviceUid || "…"}</Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable onPress={onSave} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryText}>Save</Text>
              </Pressable>

              <Pressable onPress={refresh} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Reload</Text>
              </Pressable>
            </View>

            <Text style={styles.hint}>
              Used for API calls: header <Text style={styles.mono}>x-tenant-slug</Text> and base URL.
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 10 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  card: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 6 },
  mono: { fontFamily: "monospace" },
  actionsRow: { marginTop: 12, flexDirection: "row", gap: 10, alignItems: "center" },
  btnPrimary: { backgroundColor: "#111", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnPrimaryText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnGhostText: { fontWeight: "700" },
  hint: { marginTop: 10, color: "#555" },
});
