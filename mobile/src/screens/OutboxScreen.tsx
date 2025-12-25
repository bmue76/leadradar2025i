// mobile/src/screens/OutboxScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNetInfo } from "@react-native-community/netinfo";

import { useSettings } from "../storage/SettingsContext";
import {
  clearOutbox,
  loadOutbox,
  removeOutboxItem,
  resetAllOutboxTries,
  resetOutboxItemTries,
  type OutboxError,
  type OutboxItem,
} from "../storage/outbox";
import { DEMO_FORM_ID } from "../lib/demoForms";
import { syncOutboxNow, syncOutboxOne } from "../sync/outboxSync";
import { OutboxAutoSyncIndicator, useOutboxSyncStatus } from "../sync/outboxAutoSync";

function isDemoLead(item: OutboxItem) {
  return item.formId === DEMO_FORM_ID || item.formId.startsWith("demo-");
}

function fmt(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function errorMessage(err?: OutboxItem["lastError"]): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  return (err as OutboxError).message || null;
}

function errorMeta(err?: OutboxItem["lastError"]): { code?: string; at?: string } {
  if (!err) return {};
  if (typeof err === "string") return {};
  const e = err as OutboxError;
  return { code: e.code, at: e.at };
}

function derivedStatus(item: OutboxItem): string {
  if (item.status) return item.status;
  const msg = errorMessage(item.lastError);
  if ((item.tries ?? 0) > 0 || msg) return "FAILED";
  return "QUEUED";
}

function countAttachments(item: OutboxItem) {
  const list = Array.isArray(item.attachments) ? item.attachments : [];
  const total = list.length;
  const failed = list.filter((a) => a?.status === "FAILED").length;
  const pending = list.filter((a) => a?.status === "PENDING").length;
  const uploaded = list.filter((a) => a?.status === "UPLOADED").length;
  return { total, failed, pending, uploaded };
}

export default function OutboxScreen() {
  const { isLoaded, baseUrl, tenantSlug } = useSettings();
  const netInfo = useNetInfo();

  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const syncStatus = useOutboxSyncStatus();
  const syncing = !!syncStatus.syncing;

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

  // When auto/manual sync finishes -> refresh list
  useEffect(() => {
    if (!syncStatus.syncing && syncStatus.finishedAt) {
      void reload();
    }
  }, [syncStatus.syncing, syncStatus.finishedAt, reload]);

  const canSync = useMemo(() => isLoaded && !!baseUrl && !!tenantSlug, [isLoaded, baseUrl, tenantSlug]);

  const isOnline = useMemo(() => {
    // treat "null" internetReachable as "unknown" -> fall back to isConnected
    const connected = netInfo.isConnected === true;
    const reachable = netInfo.isInternetReachable;
    if (reachable === false) return false;
    return connected;
  }, [netInfo.isConnected, netInfo.isInternetReachable]);

  const autoSyncLabel = useMemo(() => {
    // best-effort: we assume autosync is "enabled" whenever it *can* run
    if (!canSync) return "OFF (missing settings)";
    if (!isOnline) return "OFF (offline)";
    return "ON";
  }, [canSync, isOnline]);

  const lastSyncSummary = useMemo(() => {
    if (!syncStatus.finishedAt) return "—";
    if (syncStatus.skippedReason) return `skipped (${syncStatus.skippedReason})`;
    if (syncStatus.error) return `error: ${syncStatus.error}`;
    const ok = syncStatus.ok ?? 0;
    const failed = syncStatus.failed ?? 0;
    const skipped = syncStatus.skipped ?? 0;
    return `ok=${ok}, failed=${failed}, skipped=${skipped}`;
  }, [syncStatus.finishedAt, syncStatus.skippedReason, syncStatus.error, syncStatus.ok, syncStatus.failed, syncStatus.skipped]);

  function toggleDetails(id: string) {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

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

  async function onResetAllTries() {
    Alert.alert("Reset tries", "Reset tries + clear error on ALL items?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        onPress: async () => {
          await resetAllOutboxTries();
          await reload();
        },
      },
    ]);
  }

  async function onResetItemTries(itemId: string) {
    Alert.alert("Reset tries", "Reset tries + clear error for this item?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset",
        onPress: async () => {
          await resetOutboxItemTries(itemId);
          await reload();
        },
      },
    ]);
  }

  async function syncNow() {
    setLastResult(null);

    const res = await syncOutboxNow({
      baseUrl: baseUrl || undefined,
      tenantSlug: tenantSlug || undefined,
      reason: "manual",
      isOnline,
      timeoutMs: 8000,
    });

    setLastResult(res.message);
    await reload();
  }

  async function retryOne(itemId: string) {
    setLastResult(null);

    const res = await syncOutboxOne({
      itemId,
      baseUrl: baseUrl || undefined,
      tenantSlug: tenantSlug || undefined,
      reason: `retry:${itemId}`,
      isOnline,
      timeoutMs: 8000,
    });

    setLastResult(res.message);
    await reload();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>Outbox</Text>

        <OutboxAutoSyncIndicator />

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Global Status</Text>

          <Text style={styles.statusLine}>
            Online: <Text style={styles.mono}>{isOnline ? "YES" : "NO"}</Text> • Auto-sync:{" "}
            <Text style={styles.mono}>{autoSyncLabel}</Text>
          </Text>

          <Text style={styles.statusLine}>
            Settings:{" "}
            <Text style={styles.mono}>
              {isLoaded ? "loaded" : "loading"} / baseUrl={baseUrl || "—"} / tenantSlug={tenantSlug || "—"}
            </Text>
          </Text>

          <Text style={styles.statusLine}>
            Queue: <Text style={styles.mono}>{String(items.length)}</Text> (real{" "}
            <Text style={styles.mono}>{String(realCount)}</Text>, demo <Text style={styles.mono}>{String(demoCount)}</Text>)
          </Text>

          <Text style={styles.statusLine}>
            Last sync: <Text style={styles.mono}>{fmt(syncStatus.finishedAt)}</Text> •{" "}
            <Text style={styles.mono}>{lastSyncSummary}</Text>
          </Text>

          {lastResult ? <Text style={styles.result}>{lastResult}</Text> : null}
        </View>

        <View style={styles.actionsRow}>
          <Pressable onPress={reload} style={[styles.btnGhost, (loading || syncing) ? { opacity: 0.6 } : null]} disabled={loading || syncing}>
            <Text style={styles.btnGhostText}>{loading ? "Loading…" : "Reload"}</Text>
          </Pressable>

          <Pressable
            onPress={syncNow}
            style={[styles.btnPrimary, (!canSync || syncing || !isOnline) ? { opacity: 0.6 } : null]}
            disabled={!canSync || syncing || !isOnline}
          >
            <Text style={styles.btnPrimaryText}>{syncing ? "Syncing…" : "Sync now"}</Text>
          </Pressable>

          <Pressable onPress={onResetAllTries} style={[styles.btnGhost, syncing ? { opacity: 0.6 } : null]} disabled={syncing}>
            <Text style={styles.btnGhostText}>Reset tries</Text>
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

        {!isOnline ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Offline</Text>
            <Text style={styles.warnText}>Items stay queued. When online, auto-sync (if enabled) will try again.</Text>
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
            const status = derivedStatus(item);
            const msg = errorMessage(item.lastError);
            const meta = errorMeta(item.lastError);
            const expanded = !!expandedIds[item.id];
            const att = countAttachments(item);
            const valuesCount = item.values && typeof item.values === "object" ? Object.keys(item.values).length : 0;

            const actionsDisabled = syncing; // details must remain readable; actions disabled during sync
            const retryDisabled = actionsDisabled || !canSync || !isOnline || demo;

            return (
              <View style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  clientLeadId: <Text style={styles.mono}>{item.clientLeadId}</Text>{" "}
                  {demo ? <Text style={styles.badge}>DEMO</Text> : <Text style={styles.badge}>{status}</Text>}
                </Text>

                <Text style={styles.itemLine}>
                  formId: <Text style={styles.mono}>{item.formId}</Text>
                </Text>

                <Text style={styles.itemLine}>
                  createdAt: <Text style={styles.mono}>{fmt(item.createdAt)}</Text>
                </Text>

                <Text style={styles.itemLine}>
                  tries: <Text style={styles.mono}>{String(item.tries ?? 0)}</Text> • fields:{" "}
                  <Text style={styles.mono}>{String(valuesCount)}</Text>
                  {att.total ? (
                    <>
                      {" "}
                      • attachments: <Text style={styles.mono}>{String(att.total)}</Text> (pending{" "}
                      <Text style={styles.mono}>{String(att.pending)}</Text>, failed{" "}
                      <Text style={styles.mono}>{String(att.failed)}</Text>)
                    </>
                  ) : null}
                </Text>

                {msg ? (
                  <Text style={styles.itemError}>
                    lastError: {msg}
                    {meta.code ? ` (${meta.code})` : ""}
                  </Text>
                ) : null}

                <View style={styles.itemActions}>
                  <Pressable onPress={() => toggleDetails(item.id)} style={styles.btnSmall}>
                    <Text style={styles.btnSmallText}>{expanded ? "Hide details" : "Details"}</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void retryOne(item.id)}
                    style={[styles.btnSmallPrimary, retryDisabled ? { opacity: 0.6 } : null]}
                    disabled={retryDisabled}
                  >
                    <Text style={styles.btnSmallPrimaryText}>Retry</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => void onResetItemTries(item.id)}
                    style={[styles.btnSmall, actionsDisabled ? { opacity: 0.6 } : null]}
                    disabled={actionsDisabled}
                  >
                    <Text style={styles.btnSmallText}>Reset</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      Alert.alert("Delete Outbox Item", "Delete this queued item?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => void onDelete(item.id) },
                      ]);
                    }}
                    style={[styles.btnSmallDanger, actionsDisabled ? { opacity: 0.6 } : null]}
                    disabled={actionsDisabled}
                  >
                    <Text style={styles.btnSmallDangerText}>Delete</Text>
                  </Pressable>
                </View>

                {expanded ? (
                  <View style={styles.detailsBox}>
                    <Text style={styles.detailsTitle}>Details</Text>

                    <Text style={styles.detailsLine}>
                      status: <Text style={styles.mono}>{String(status)}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      lastAttemptAt: <Text style={styles.mono}>{fmt(item.lastAttemptAt)}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      lastSuccessAt: <Text style={styles.mono}>{fmt(item.lastSuccessAt)}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      lastErrorAt: <Text style={styles.mono}>{fmt(meta.at)}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      lastErrorCode: <Text style={styles.mono}>{meta.code || "—"}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      capturedByDeviceUid: <Text style={styles.mono}>{item.capturedByDeviceUid || "—"}</Text>
                    </Text>

                    <Text style={styles.detailsLine}>
                      hasCardInline: <Text style={styles.mono}>{item.cardImageBase64 ? "YES" : "NO"}</Text>
                    </Text>

                    {att.total ? (
                      <Text style={styles.detailsLine}>
                        legacyAttachments: <Text style={styles.mono}>{String(att.total)}</Text> (uploaded{" "}
                        <Text style={styles.mono}>{String(att.uploaded)}</Text>, pending{" "}
                        <Text style={styles.mono}>{String(att.pending)}</Text>, failed{" "}
                        <Text style={styles.mono}>{String(att.failed)}</Text>)
                      </Text>
                    ) : null}
                  </View>
                ) : null}
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

  statusCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 6 },
  statusTitle: { fontSize: 14, fontWeight: "900" },
  statusLine: { color: "#444" },

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

  itemActions: { marginTop: 8, flexDirection: "row", gap: 10, flexWrap: "wrap" },
  btnSmall: { borderWidth: 1, borderColor: "#ddd", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  btnSmallText: { fontWeight: "900" },

  btnSmallPrimary: { backgroundColor: "#111", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  btnSmallPrimaryText: { color: "#fff", fontWeight: "900" },

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

  detailsBox: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 10,
    gap: 4,
  },
  detailsTitle: { fontWeight: "900" },
  detailsLine: { color: "#444" },
});
