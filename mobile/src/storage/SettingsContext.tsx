import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { getOrCreateDeviceUid, loadSettings, saveSettings } from "./settings";

type SettingsState = {
  isLoaded: boolean;
  baseUrl: string;
  tenantSlug: string;
  deviceUid: string;
  refresh: () => Promise<void>;
  updateSettings: (input: { baseUrl: string; tenantSlug: string }) => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);

function normalizeBaseUrl(v: string) {
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [baseUrl, setBaseUrl] = useState("http://<LAN-IP>:3000");
  const [tenantSlug, setTenantSlug] = useState("");
  const [deviceUid, setDeviceUid] = useState("");

  const refresh = async () => {
    setIsLoaded(false);
    try {
      const uid = await getOrCreateDeviceUid();
      setDeviceUid(uid);

      const s = await loadSettings();
      setBaseUrl(normalizeBaseUrl(s.baseUrl));
      setTenantSlug(s.tenantSlug);
    } finally {
      setIsLoaded(true);
    }
  };

  const updateSettings = async (input: { baseUrl: string; tenantSlug: string }) => {
    const nextBaseUrl = normalizeBaseUrl(input.baseUrl);
    const nextTenantSlug = input.tenantSlug.trim();

    if (!nextTenantSlug) {
      Alert.alert("Missing tenantSlug", "Please set tenantSlug (required).");
      return;
    }
    if (!nextBaseUrl) {
      Alert.alert("Missing baseUrl", "Please set baseUrl (required).");
      return;
    }

    await saveSettings({ baseUrl: nextBaseUrl, tenantSlug: nextTenantSlug });
    setBaseUrl(nextBaseUrl);
    setTenantSlug(nextTenantSlug);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SettingsState>(
    () => ({
      isLoaded,
      baseUrl,
      tenantSlug,
      deviceUid,
      refresh,
      updateSettings,
    }),
    [isLoaded, baseUrl, tenantSlug, deviceUid]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
