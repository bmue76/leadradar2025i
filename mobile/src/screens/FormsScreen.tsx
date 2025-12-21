import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { RootStackParamList } from "../navigation/types";
import { useSettings } from "../storage/SettingsContext";
import { mobileGetJson } from "../lib/mobileApi";
import {
  loadFormsListCache,
  saveFormsListCache,
  loadFormDetailCache,
  saveFormDetailCache,
} from "../storage/formsCache";
import { getDemoFormsList } from "../lib/demoForms";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type MobileFormListItem = {
  id: string;
  name: string;
  fieldCount?: number;
};

function unwrapPayload(data: any) {
  // supports:
  // - { ok:true, data: {...} } (jsonOk)
  // - direct payload
  return data && typeof data === "object" && "data" in data ? (data as any).data : data;
}

function normalizeList(raw: any): MobileFormListItem[] {
  const data = unwrapPayload(raw);

  const arr: any[] =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.forms)
        ? data.forms
        : Array.isArray(data?.items)
          ? data.items
          : [];

  return arr
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      id: String(x.id),
      name: String(x.name ?? "Unnamed form"),
      fieldCount:
        typeof x.fieldCount === "number"
          ? x.fieldCount
          : typeof x.fieldsCount === "number"
            ? x.fieldsCount
            : typeof x._count?.fields === "number"
              ? x._count.fields
              : undefined,
    }));
}

function demoList(): MobileFormListItem[] {
  return getDemoFormsList().map((x) => ({ id: x.id, name: x.name, fieldCount: x.fieldCount }));
}

export default function FormsScreen() {
  const navigation = useNavigation<Nav>();
  const { isLoaded, baseUrl, tenantSlug } = useSettings();

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<"ONLINE" | "CACHE" | "DEMO">("DEMO");
  const [forms, setForms] = useState<MobileFormListItem[]>([]);

  const [prefetching, setPrefetching] = useState(false);
  const [prefetchDone, setPrefetchDone] = useState(0);
  const [prefetchTotal, setPrefetchTotal] = useState(0);

  const [offlineReadyMap, setOfflineReadyMap] = useState<Record<string, boolean>>({});
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const canTryOnline = useMemo(() => isLoaded && !!baseUrl && !!tenantSlug, [isLoaded, baseUrl, tenantSlug]);

  const offlineReadyCount = useMemo(() => {
    let c = 0;
    for (const f of forms) if (offlineReadyMap[f.id]) c += 1;
    return c;
  }, [forms, offlineReadyMap]);

  const refreshOfflineReadyMap = useCallback(async (list: MobileFormListItem[]) => {
    const next: Record<string, boolean> = {};
    for (const item of list) {
      try {
        const cached = await loadFormDetailCache(item.id);
        next[item.id] = !!cached.payload;
      } catch {
        next[item.id] = false;
      }
    }
    if (!isMountedRef.current) return;
    setOfflineReadyMap(next);
  }, []);

  const applyCacheOrDemo = useCallback(async (reason: string) => {
    const cached = await loadFormsListCache();
    const cachedList = cached.payload ? normalizeList(cached.payload) : [];

    if (cachedList.length > 0) {
      if (!isMountedRef.current) return;
      setForms(cachedList);
      setMode("CACHE");
      setNotice(`${reason} → cached forms (last: ${cached.meta?.updatedAt ?? "unknown"})`);
      void refreshOfflineReadyMap(cachedList);
      return;
    }

    if (!isMountedRef.current) return;
    const demo = demoList();
    setForms(demo);
    setMode("DEMO");
    setNotice(`${reason} → DEMO (no cache yet)`);
    void refreshOfflineReadyMap(demo);
  }, [refreshOfflineReadyMap]);

  const prefetchAllFormDetails = useCallback(
    async (list: MobileFormListItem[]) => {
      if (!canTryOnline) {
        setNotice("Offline pack: needs baseUrl + tenantSlug + backend running.");
        return;
      }
      if (!baseUrl || !tenantSlug) return;
      if (list.length === 0) return;

      setPrefetching(true);
      setPrefetchDone(0);
      setPrefetchTotal(list.length);

      let done = 0;

      for (const item of list) {
        try {
          const raw = await mobileGetJson<any>({
            baseUrl,
            tenantSlug,
            path: `/api/mobile/v1/forms/${encodeURIComponent(item.id)}`,
            timeoutMs: 2500,
          });
          await saveFormDetailCache(item.id, raw);

          if (isMountedRef.current) {
            setOfflineReadyMap((prev) => ({ ...prev, [item.id]: true }));
          }
        } catch {
          // best effort
        } finally {
          done += 1;
          if (isMountedRef.current) setPrefetchDone(done);
        }
      }

      if (!isMountedRef.current) return;
      setPrefetching(false);
      setNotice("Offline pack finished. You can go offline now.");
    },
    [canTryOnline, baseUrl, tenantSlug]
  );

  const load = useCallback(async () => {
    if (!isLoaded) return;

    setLoading(true);
    setNotice(null);

    try {
      if (canTryOnline) {
        const raw = await mobileGetJson<any>({
          baseUrl: baseUrl!,
          tenantSlug: tenantSlug!,
          path: "/api/mobile/v1/forms",
          timeoutMs: 2500,
        });

        const normalized = normalizeList(raw);

        if (!isMountedRef.current) return;
        setForms(normalized);
        setMode("ONLINE");

        const meta = await saveFormsListCache(raw);
        setNotice(
          normalized.length > 0
            ? `Online ✓ (cached ${meta.updatedAt})`
            : `Online ✓ (cached ${meta.updatedAt}) — no ACTIVE forms returned`
        );

        void refreshOfflineReadyMap(normalized);

        // auto-download offline pack (best effort)
        if (normalized.length > 0) void prefetchAllFormDetails(normalized);
        return;
      }

      await applyCacheOrDemo(!tenantSlug ? "Missing tenantSlug" : !baseUrl ? "Missing baseUrl" : "Offline");
    } catch {
      await applyCacheOrDemo("Backend not reachable");
    } finally {
      setLoading(false);
    }
  }, [
    isLoaded,
    canTryOnline,
    baseUrl,
    tenantSlug,
    applyCacheOrDemo,
    refreshOfflineReadyMap,
    prefetchAllFormDetails,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  function openCapture(item: MobileFormListItem) {
    navigation.navigate("Capture", { formId: item.id, formName: item.name });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.h1}>Forms</Text>

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Status</Text>
          <Text style={styles.statusLine}>
            mode: <Text style={styles.mono}>{mode}</Text>
          </Text>
          <Text style={styles.statusLine}>
            tenantSlug: <Text style={styles.mono}>{tenantSlug || "—"}</Text>
          </Text>
          <Text style={styles.statusLine}>
            baseUrl: <Text style={styles.mono}>{baseUrl || "—"}</Text>
          </Text>
          <Text style={styles.statusLine}>
            offline ready:{" "}
            <Text style={styles.mono}>
              {offlineReadyCount}/{forms.length}
            </Text>
            {prefetching ? (
              <Text>
                {" "}
                (downloading {prefetchDone}/{prefetchTotal})
              </Text>
            ) : null}
          </Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={load}
            style={[styles.btnGhost, (loading || prefetching) ? { opacity: 0.6 } : null]}
            disabled={loading || prefetching}
          >
            <Text style={styles.btnGhostText}>{loading ? "Loading…" : "Reload"}</Text>
          </Pressable>

          <Pressable
            onPress={() => prefetchAllFormDetails(forms)}
            style={[
              styles.btnPrimary,
              (!canTryOnline || prefetching || forms.length === 0) ? { opacity: 0.6 } : null,
            ]}
            disabled={!canTryOnline || prefetching || forms.length === 0}
          >
            <Text style={styles.btnPrimaryText}>{prefetching ? "Downloading…" : "Download offline pack"}</Text>
          </Pressable>

          <Text style={styles.hint}>
            Einmal online laden → “offline ready = n/n” → danach backend aus → alle Forms bleiben verfügbar.
          </Text>
        </View>

        <FlatList
          data={forms}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No forms</Text>
              <Text style={styles.emptyText}>
                Wenn du ACTIVE Forms erwartest: Backend starten und “Reload” drücken. (Oder Settings prüfen.)
              </Text>
              <Text style={styles.emptyText}>
                Demo wird nur angezeigt, wenn Backend nicht erreichbar ist UND kein Cache existiert.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const ready = !!offlineReadyMap[item.id];
            return (
              <Pressable onPress={() => openCapture(item)} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowSub}>
                    {typeof item.fieldCount === "number" ? `${item.fieldCount} fields` : "tap to capture"} ·{" "}
                    <Text style={ready ? styles.ok : styles.pending}>{ready ? "offline ✓" : "offline …"}</Text>
                  </Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, padding: 16, gap: 10 },
  h1: { fontSize: 22, fontWeight: "700", marginBottom: 8 },

  actionsRow: { gap: 10 },
  hint: { color: "#666", fontSize: 12 },

  btnGhost: {
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  btnGhostText: { fontWeight: "800" },

  btnPrimary: {
    backgroundColor: "#111",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "900" },

  statusCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 6 },
  statusTitle: { fontSize: 14, fontWeight: "900" },
  statusLine: { color: "#444" },
  notice: { marginTop: 6, color: "#333", fontWeight: "900" },
  mono: { fontFamily: "monospace" },

  emptyCard: { borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 12, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900" },
  emptyText: { color: "#444" },

  row: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { fontSize: 16, fontWeight: "700" },
  rowSub: { marginTop: 2, color: "#666" },
  ok: { color: "#0a6", fontWeight: "900" },
  pending: { color: "#666", fontWeight: "900" },
  chev: { fontSize: 26, color: "#666", marginLeft: 8 },
});
