import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSettings } from "../storage/SettingsContext";
import { mobilePostJson } from "../lib/mobileApi";
import { clearOutbox, loadOutbox, removeOutboxItem, updateOutboxItem, type OutboxItem } from "../storage/outbox";
import { DEMO_FORM_ID } from "../lib/demoForms";

function isDemoLead(item: OutboxItem) {
  return item.formId === DEMO_FORM_ID || item.formId.startsWith("demo-");
}

export default function OutboxScreen() {
  const { isLoaded, baseUrl, tenantSlug } = useSettings();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const demoCount = useMemo(() => items.filter(isDemoLead).length, [items]);
  const realCount = useMemo(() => items.length - demoCount, [items, demoCount]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadOutbox();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const canSync = useMemo(() => isLoaded && !!baseUrl && !!tenantSlug, [isLoaded, baseUrl, tenantSlug]);

  async function onDelete(id: string) {
    await removeOutboxItem(id);
    await reload();
  }

  async function onClearAll() {
    Alert.alert("Clear Outbox", "Delete ALL queued items?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await clearOutbox();
          await reload();
        },
      },
    ]);
  }

  async function syncNow() {
    setLastResult(null);

    if (!canSync) {
      setLastResult("Cannot sync: missing baseUrl/tenantSlug (Settings) or settings not loaded.");
      return;
    }

    setSyncing(true);

    let ok = 0;
    let failed = 0;
    let skipped = 0;

    try {
      const current = await loadOutbox();

      for (const item of current) {
        // Demo items are local-only; backend can't accept them.
        if (isDemoLead(item)) {
          skipped += 1;
          await updateOutboxItem(item.id, {
            lastError: "Demo lead (local only) — delete this item when done testing.",
          });
          continue;
        }

        try {
          await mobilePostJson({
            baseUrl: baseUrl!,
            tenantSlug: tenantSlug!,
            path: "/api/mobile/v1/leads",
            timeoutMs: 8000,
            body: {
              formId: item.formId,
              clientLeadId: item.clientLeadId,
              values: item.values,
              capturedByDeviceUid: item.capturedByDeviceUid,
            },
          });

          ok += 1;
          await removeOutboxItem(item.id);
        } catch (e: any) {
          failed += 1;
          const msg = e?.message ? String(e.message) : "Sync failed";
          await updateOutboxItem(item.id, {
            tries: (item.tries ?? 0) + 1,
            lastError: msg,
          });
        }
      }

      setLastResult(`Sync finished: ok=${ok}, failed=${failed}, skipped(demo)=${skipped}`);
    } finally {
      setSyncing(false);
      await reload();
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>Outbox</Text>

        <View style={styles.debugCard}>
          <Text style={styles.debugTitle}>Debug</Text>
          <Text style={styles.debugLine}>
            baseUrl: <Text style={styles.mono}>{baseUrl || "—"}</Text>
          </Text>
          <Text style={styles.debugLine}>
            tenantSlug: <Text style={styles.mono}>{tenantSlug || "—"}</Text>
          </Text>
          <Text style={styles.debugLine}>
            queued: <Text style={styles.mono}>{String(items.length)}</Text> (real{" "}
            <Text style={styles.mono}>{String(realCount)}</Text>, demo{" "}
            <Text style={styles.mono}>{String(demoCount)}</Text>)
          </Text>
          {lastResult ? <Text style={styles.result}>{lastResult}</Text> : null}
        </View>

        <View style={styles.actionsRow}>
          <Pressable onPress={reload} style={[styles.btnGhost, loading ? { opacity: 0.6 } : null]} disabled={loading}>
            <Text style={styles.btnGhostText}>{loading ? "Loading…" : "Reload"}</Text>
          </Pressable>

          <Pressable
            onPress={syncNow}
            style={[styles.btnPrimary, (!canSync || syncing) ? { opacity: 0.6 } : null]}
            disabled={!canSync || syncing}
          >
            <Text style={styles.btnPrimaryText}>{syncing ? "Syncing…" : "Sync now"}</Text>
          </Pressable>

          <Pressable onPress={onClearAll} style={[styles.btnDanger, syncing ? { opacity: 0.6 } : null]} disabled={syncing}>
            <Text style={styles.btnDangerText}>Clear</Text>
          </Pressable>
        </View>

        {!canSync ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Sync disabled</Text>
            <Text style={styles.warnText}>
              Set <Text style={styles.mono}>baseUrl</Text> + <Text style={styles.mono}>tenantSlug</Text> in Settings and ensure backend is running.
            </Text>
            <Text style={styles.warnText}>
              Android Emulator tip: backend on your PC is usually <Text style={styles.mono}>http://10.0.2.2:3000</Text>.
            </Text>
          </View>
        ) : null}

        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Outbox is empty</Text>
              <Text style={styles.p}>Create leads offline to see them here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const demo = isDemoLead(item);
            return (
              <View style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  clientLeadId: <Text style={styles.mono}>{item.clientLeadId}</Text>
                </Text>
                <Text style={styles.itemLine}>
                  formId: <Text style={styles.mono}>{item.formId}</Text> {demo ? <Text style={styles.badge}>DEMO</Text> : null}
                </Text>
                <Text style={styles.itemLine}>
                  createdAt: <Text style={styles.mono}>{item.createdAt}</Text>
                </Text>
                <Text style={styles.itemLine}>
                  tries: <Text style={styles.mono}>{String(item.tries ?? 0)}</Text>
                </Text>
                {item.lastError ? <Text style={styles.itemError}>lastError: {item.lastError}</Text> : null}

                <View style={styles.itemActions}>
                  <Pressable onPress={() => onDelete(item.id)} style={styles.btnSmallDanger}>
                    <Text style={styles.btnSmallDangerText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: "700" },

  actionsRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  btnGhost: { borderWidth: 1, borderColor: "#ddd", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnGhostText: { fontWeight: "800" },

  btnPrimary: { backgroundColor: "#111", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },

  btnDanger: { borderWidth: 1, borderColor: "#b00020", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnDangerText: { color: "#b00020", fontWeight: "900" },

  debugCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 6 },
  debugTitle: { fontSize: 14, fontWeight: "900" },
  debugLine: { color: "#444" },
  result: { marginTop: 6, fontWeight: "900" },
  mono: { fontFamily: "monospace" },

  warnCard: { borderWidth: 1, borderColor: "#f0c", borderRadius: 12, padding: 12, gap: 6 },
  warnTitle: { fontWeight: "900" },
  warnText: { color: "#444" },

  card: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "800" },
  p: { color: "#444" },

  itemCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 6 },
  itemTitle: { fontWeight: "900" },
  itemLine: { color: "#444" },
  itemError: { marginTop: 4, color: "#b00020", fontWeight: "800" },

  itemActions: { marginTop: 8, flexDirection: "row", gap: 10 },
  btnSmallDanger: { borderWidth: 1, borderColor: "#b00020", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  btnSmallDangerText: { color: "#b00020", fontWeight: "900" },

  badge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#111",
    fontSize: 11,
    fontWeight: "900",
  },
});
