import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, DeviceEventEmitter, Text, View } from "react-native";
import NetInfo, { useNetInfo } from "@react-native-community/netinfo";

import { useSettings } from "../storage/SettingsContext";
import { OUTBOX_SYNC_STATUS_EVENT, syncOutboxNow, type OutboxSyncStatus } from "./outboxSync";

function fmt(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function useOutboxSyncStatus(): OutboxSyncStatus {
  const [status, setStatus] = useState<OutboxSyncStatus>({ syncing: false });

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(OUTBOX_SYNC_STATUS_EVENT, (payload: OutboxSyncStatus) => {
      setStatus(payload);
    });
    return () => sub.remove();
  }, []);

  return status;
}

export function OutboxAutoSyncIndicator() {
  const net = useNetInfo();
  const s = useOutboxSyncStatus();

  const online = !!(net.isConnected && net.isInternetReachable !== false);

  const label = useMemo(() => {
    if (s.syncing) return "Syncing…";
    if (s.skippedReason) return `Skipped (${s.skippedReason})`;
    if (s.failed && s.failed > 0) return `Last: ❌ FAIL (${s.failed})`;
    if (s.ok && s.ok > 0) return `Last: ✅ OK (${s.ok})`;
    return "Last: —";
  }, [s.syncing, s.skippedReason, s.failed, s.ok]);

  const when = useMemo(() => (s.syncing ? fmt(s.startedAt) : fmt(s.finishedAt)), [s.syncing, s.startedAt, s.finishedAt]);

  return (
    <View style={{ borderWidth: 1, borderColor: "#eee", borderRadius: 12, padding: 10, gap: 4 }}>
      <Text style={{ fontSize: 12, fontWeight: "900" }}>
        {online ? "Online" : "Offline"} · Auto-sync: ON · {label}
      </Text>
      <Text style={{ fontSize: 11, color: "#444" }}>
        {s.reason ? `Reason: ${s.reason} · ` : ""}Time: {when}
        {s.error ? ` · Error: ${s.error}` : ""}
      </Text>
    </View>
  );
}

/**
 * Auto-Sync Engine:
 * - on app start (once)
 * - on foreground
 * - on offline->online transition
 * - backoff retry on failures (1s,2s,5s,10s,... max 30s)
 * - cancels retry when offline, resets on success
 */
export function useOutboxAutoSyncGate() {
  const { isLoaded, baseUrl, tenantSlug } = useSettings();
  const net = useNetInfo();

  const online = !!(net.isConnected && net.isInternetReachable !== false);

  const startedRef = useRef(false);
  const prevOnlineRef = useRef<boolean | null>(null);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef<number>(1000);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const resetBackoff = useCallback(() => {
    backoffRef.current = 1000;
  }, []);

  const scheduleRetry = useCallback(
    (reason: string) => {
      clearRetry();
      const delay = Math.min(backoffRef.current, 30000);

      retryTimerRef.current = setTimeout(() => {
        void maybeSync(`retry:${reason}`);
      }, delay);

      // simple exponential-ish (1s,2s,4s,8s,16s,30s cap)
      backoffRef.current = Math.min(backoffRef.current * 2, 30000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearRetry]
  );

  const maybeSync = useCallback(
    async (reason: string) => {
      if (!online) return;
      if (!isLoaded || !baseUrl || !tenantSlug) return;

      const res = await syncOutboxNow({
        baseUrl,
        tenantSlug,
        reason,
        isOnline: online,
        timeoutMs: 8000,
      });

      // Backoff rule: if any failed -> retry later; otherwise reset.
      if (res.failed > 0) scheduleRetry(reason);
      else {
        resetBackoff();
        clearRetry();
      }
    },
    [online, isLoaded, baseUrl, tenantSlug, scheduleRetry, resetBackoff, clearRetry]
  );

  // App start once
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Ensure we have a reachability snapshot
    NetInfo.fetch()
      .then(() => {
        void maybeSync("start");
      })
      .catch(() => {
        // rely on later triggers
      });

    return () => {
      clearRetry();
    };
  }, [maybeSync, clearRetry]);

  // Foreground trigger
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") {
        void maybeSync("foreground");
      }
    });
    return () => sub.remove();
  }, [maybeSync]);

  // Online transition + cancel on offline
  useEffect(() => {
    const prev = prevOnlineRef.current;
    prevOnlineRef.current = online;

    if (prev === null) return; // first run handled by start
    if (prev === false && online === true) {
      void maybeSync("online");
    }
    if (online === false) {
      clearRetry();
      resetBackoff();
    }
  }, [online, maybeSync, clearRetry, resetBackoff]);
}

export function OutboxAutoSyncGate() {
  useOutboxAutoSyncGate();
  return null;
}
