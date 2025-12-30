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
import { computeOnlineState, type OnlineState } from "../lib/OutboxOnline";

function isDemoLead(item: OutboxItem) {
  return item.formId === DEMO_FORM_ID || item.formId.startsWith("demo-");
}

function fmt(v?: string | number | null) {
  if (v === null || v === undefined) return "—";
  try {
    if (typeof v === "number") return new Date(v).toLocaleString();
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
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

function makeInitialOnlineState(): OnlineState {
  return {
    online: false,
    checkedAt: Date.now(), // ✅ number
    probe: null,
  };
}

function probeToLabel(probe: OnlineState["probe"]): string {
  if (!probe) return "—";

  // unknown exact shape → safe lookup
  const p: any = probe;
  const ok = p?.ok === true;

  const ms =
    (typeof p?.ms === "number" && p.ms) ||
    (typeof p?.latencyMs === "number" && p.latencyMs) ||
    (typeof p?.durationMs === "number" && p.durationMs) ||
    (typeof p?.tookMs === "number" && p.tookMs) ||
    (typeof p?.elapsedMs === "number" && p.elapsedMs) ||
    null;

  const err =
    (typeof p?.error === "string" && p.error) ||
    (typeof p?.message === "string" && p.message) ||
    (typeof p?.details === "string" && p.details) ||
    null;

  if (ok) return ms ? `ok (${ms}ms)` : "ok";
  return err ? `fail (${err})` : "fail";
}

export default function OutboxScreen() {
  const { isLoaded, baseUrl, tenantSlug } = useSettings();
  const netInfo = useNetInfo();

  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [onlineState, setOnlineState] = useState<OnlineState>(() => makeInitialOnlineState());
  const [probing, setProbing] = useState(false);

  const syncStatus = useOutboxSyncStatus();
  const syncing = !!syncStatus.syncing;

  const demoCount = useMemo(() => items.filter(isDemoLead).length, [items]);
  const realCount = useMemo(() => items.length - demoCount, [items, demoCount]);

  const canSync = useMemo(() => isLoaded && !!baseUrl && !!tenantSlug, [isLoaded, baseUrl, tenantSlug]);

  const netConnected = netInfo.isConnected !== false;
  const netReachable = netInfo.isInternetReachable !== false;
  const netOffline = !netConnected || !netReachable;

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
    void reload();
  }, [reload]);

  // When auto/manual sync finishes -> refresh list
  useEffect(() => {
    if (!syncStatus.syncing && syncStatus.finishedAt) {
      void reload();
    }
  }, [syncStatus.syncing, syncStatus.finishedAt, reload]);

  const refreshOnline = useCallback(async () => {
    if (!canSync || !baseUrl || !tenantSlug) {
      setOnlineState(makeInitialOnlineState());
      return;
    }

    // If NetInfo is clearly offline: short-circuit (avoid probes)
    if (netOffline) {
      setOnlineState({
        online: false,
        checkedAt: Date.now(), // ✅ number
        probe: null,
      });
      return;
    }

    setProbing(true);
    try {
      const state = await computeOnlineState({
        baseUrl,
        tenantSlug,
        timeoutMs: 2500,
      });
      setOnlineState(state);
    } finally {
      setProbing(false);
    }
  }, [canSync, baseUrl, tenantSlug, netOffline]);

  useEffect(() => {
    void refreshOnline();
  }, [refreshOnline]);

  const isOnline = onlineState.online;

  const autoSyncLabel = useMemo(() => {
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

    await refreshOnline();

    const res = await syncOutboxNow({
      baseUrl: baseUrl || undefined,
      tenantSlug: tenantSlug || undefined,
      reason: "manual",
      isOnline: onlineState.online,
      timeoutMs: 8000,
    });

    setLastResult(res.message);
    await reload();
    await refreshOnline();
  }

  async function retryOne(itemId: string) {
    setLastResult(null);

    await refreshOnline();

    const res = await syncOutboxOne({
      itemId,
      baseUrl: baseUrl || undefined,
      tenantSlug: tenantSlug || undefined,
      reason: `retry:${itemId}`,
      isOnline: onlineState.online,
      timeoutMs: 8000,
    });

    setLastResult(res.message);
    await reload();
    await refreshOnline();
  }

  const probeLabel = useMemo(() => probeToLabel(onlineState.probe), [onlineState.probe]);

  const renderItem = useCallback(
    ({ item }: { item: OutboxItem }) => {
      const demo = isDemoLead(item);
      const expanded = !!expandedIds[item.id];
      const status = derivedStatus(item);
      const msg = errorMessage(item.lastError);
      const meta = errorMeta(item.lastError);
      const atts = countAttachments(item);

      const actionsDisabled = syncing || loading;
      const retryDisabled = actionsDisabled || !canSync || !isOnline || demo;

      return (
        <View style={styles.itemCard}>
          <Pressable onPress={() => toggleDetails(item.id)} style={styles.itemHeader}>
            <Text style={styles.itemTitle}>
              <Text style={styles.mono}>{status}</Text> • <Text style={styles.mono}>{item.clientLeadId}</Text>
            </Text>
            <Text style={styles.itemSub}>
              {fmt(item.createdAt)} • formId=<Text style={styles.mono}>{item.formId}</Text> • tries=
              <Text style={styles.mono}>{String(item.tries ?? 0)}</Text>
              {demo ? " • DEMO" : ""}
            </Text>

            {msg ? (
              <Text style={styles.itemError}>
                {meta.code ? <Text style={styles.mono}>{meta.code}: </Text> : null}
                {msg}
              </Text>
            ) : null}
          </Pressable>

          {expanded ? (
            <View style={styles.itemDetails}>
              <Text style={styles.detailLine}>
                Status: <Text style={styles.mono}>{status}</Text> • lastAttempt:{" "}
                <Text style={styles.mono}>{fmt(item.lastAttemptAt)}</Text> • lastSuccess:{" "}
                <Text style={styles.mono}>{fmt(item.lastSuccessAt)}</Text>
              </Text>

              <Text style={styles.detailLine}>
                Attachments: <Text style={styles.mono}>{String(atts.total)}</Text> (pending{" "}
                <Text style={styles.mono}>{String(atts.pending)}</Text>, uploaded{" "}
                <Text style={styles.mono}>{String(atts.uploaded)}</Text>, failed{" "}
                <Text style={styles.mono}>{String(atts.failed)}</Text>)
              </Text>

              {item.cardImageBase64 ? (
                <Text style={styles.detailLine}>
                  Card inline: <Text style={styles.mono}>YES</Text>
                </Text>
              ) : null}

              <Text style={styles.detailLine}>
                Values: <Text style={styles.mono}>{JSON.stringify(item.values ?? {}).slice(0, 240)}</Text>
                {JSON.stringify(item.values ?? {}).length > 240 ? "…" : ""}
              </Text>

              <View style={styles.row}>
                <Pressable
                  style={[styles.btnPrimary, retryDisabled ? { opacity: 0.6 } : null]}
                  disabled={retryDisabled}
                  onPress={() => retryOne(item.id)}
                >
                  <Text style={styles.btnText}>Retry</Text>
                </Pressable>

                <Pressable
                  style={[styles.btnGhost, actionsDisabled ? { opacity: 0.6 } : null]}
                  disabled={actionsDisabled}
                  onPress={() => onResetItemTries(item.id)}
                >
                  <Text style={styles.btnGhostText}>Reset tries</Text>
                </Pressable>

                <Pressable
                  style={[styles.btnDanger, actionsDisabled ? { opacity: 0.6 } : null]}
                  disabled={actionsDisabled}
                  onPress={() => onDelete(item.id)}
                >
                  <Text style={styles.btnText}>Delete</Text>
                </Pressable>
              </View>

              {demo ? <Text style={styles.hint}>Demo items are shown for UX/testing, but are not synced.</Text> : null}
              {!canSync ? <Text style={styles.hint}>Missing settings (baseUrl/tenantSlug) → cannot sync.</Text> : null}
              {canSync && !isOnline ? (
                <Text style={styles.hint}>Backend not reachable (Health probe) → cannot sync now.</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      );
    },
    [expandedIds, syncing, loading, canSync, isOnline]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>Outbox</Text>

        <OutboxAutoSyncIndicator />

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Global Status</Text>

          <Text style={styles.statusLine}>
            Online: <Text style={styles.mono}>{isOnline ? "YES" : "NO"}</Text> • Probe:{" "}
            <Text style={styles.mono}>{probeLabel}</Text>
            {probing ? <Text style={styles.mono}> (…)</Text> : null} • Auto-sync:{" "}
            <Text style={styles.mono}>{autoSyncLabel}</Text>
          </Text>

          <Text style={styles.statusLine}>
            Checked: <Text style={styles.mono}>{fmt(onlineState.checkedAt)}</Text> • NetInfo:{" "}
            <Text style={styles.mono}>{netOffline ? "OFFLINE" : "OK"}</Text>
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

          <View style={styles.row}>
            <Pressable
              style={[styles.btnPrimary, (!canSync || syncing || !isOnline) ? { opacity: 0.6 } : null]}
              disabled={!canSync || syncing || !isOnline}
              onPress={syncNow}
            >
              <Text style={styles.btnText}>{syncing ? "Syncing…" : "Sync now"}</Text>
            </Pressable>

            <Pressable
              style={[styles.btnGhost, (syncing || loading) ? { opacity: 0.6 } : null]}
              disabled={syncing || loading}
              onPress={onResetAllTries}
            >
              <Text style={styles.btnGhostText}>Reset all tries</Text>
            </Pressable>

            <Pressable
              style={[styles.btnDanger, (syncing || loading) ? { opacity: 0.6 } : null]}
              disabled={syncing || loading}
              onPress={onClearAll}
            >
              <Text style={styles.btnText}>Clear all</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Queued items</Text>
          <Pressable style={[styles.btnMini]} onPress={reload} disabled={loading || syncing}>
            <Text style={styles.btnMiniText}>{loading ? "Loading…" : "Reload"}</Text>
          </Pressable>
        </View>

        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={items.length ? undefined : { paddingVertical: 24 }}
          ListEmptyComponent={<Text style={styles.empty}>Outbox is empty. (Offline/failed submits will be queued here.)</Text>}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b0b0b" },
  container: { flex: 1, padding: 16, gap: 12 },

  h1: { fontSize: 22, fontWeight: "700", color: "white" },

  statusCard: {
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 12,
    padding: 12,
    gap: 6,
    backgroundColor: "#101010",
  },
  statusTitle: { fontSize: 14, fontWeight: "700", color: "white" },
  statusLine: { color: "#cfcfcf", fontSize: 12 },
  mono: { fontFamily: "monospace" },
  result: { marginTop: 8, color: "#d7d7d7", fontSize: 12 },

  row: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },

  btnPrimary: { backgroundColor: "#c1121f", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  btnDanger: { backgroundColor: "#333", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  btnGhost: { borderWidth: 1, borderColor: "#333", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { color: "white", fontWeight: "700", fontSize: 12 },
  btnGhostText: { color: "#eaeaea", fontWeight: "700", fontSize: 12 },

  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  listTitle: { color: "white", fontWeight: "700" },
  btnMini: { borderWidth: 1, borderColor: "#333", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  btnMiniText: { color: "#eaeaea", fontWeight: "700", fontSize: 12 },

  empty: { color: "#bdbdbd", textAlign: "center", marginTop: 24 },

  itemCard: { borderWidth: 1, borderColor: "#222", borderRadius: 12, backgroundColor: "#101010", marginBottom: 10 },
  itemHeader: { padding: 12, gap: 4 },
  itemTitle: { color: "white", fontWeight: "700" },
  itemSub: { color: "#cfcfcf", fontSize: 12 },
  itemError: { color: "#ffb4b4", fontSize: 12 },

  itemDetails: { padding: 12, paddingTop: 0, gap: 6 },
  detailLine: { color: "#d7d7d7", fontSize: 12 },
  hint: { color: "#9c9c9c", fontSize: 12, marginTop: 6 },
});
