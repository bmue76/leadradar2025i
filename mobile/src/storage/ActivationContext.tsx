import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  clearActivation,
  clearDenied,
  isActivationValidNow,
  loadActivation,
  saveActivation,
  saveDenied,
  type ActivationRecord,
} from "./activation";

type ActivationState = {
  isLoaded: boolean;

  active: boolean;
  expiresAt: string | null;
  keyLast4: string | null;
  licenseKeyId: string | null;

  lastDeniedCode: string | null;
  lastDeniedMessage: string | null;
  lastDeniedAt: string | null;

  isActiveNow: boolean;

  refresh: () => Promise<void>;
  applyActivation: (input: {
    active: boolean;
    expiresAt: string | null;
    keyLast4: string | null;
    licenseKeyId: string | null;
  }) => Promise<void>;
  setDenied: (input: { code: string | null; message: string | null }) => Promise<void>;
  clearDenied: () => Promise<void>;
  clear: () => Promise<void>;
};

const ActivationContext = createContext<ActivationState | null>(null);

export function ActivationProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [record, setRecord] = useState<ActivationRecord>({
    active: false,
    expiresAt: null,
    keyLast4: null,
    licenseKeyId: null,

    lastDeniedCode: null,
    lastDeniedMessage: null,
    lastDeniedAt: null,

    updatedAt: new Date(0).toISOString(),
  });

  // Tick, damit Expiry auch ohne Reload greift
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const refresh = async () => {
    setIsLoaded(false);
    try {
      const rec = await loadActivation();
      setRecord(rec);
    } finally {
      setIsLoaded(true);
    }
  };

  const applyActivation = async (input: {
    active: boolean;
    expiresAt: string | null;
    keyLast4: string | null;
    licenseKeyId: string | null;
  }) => {
    // Success path clears lastDenied fields
    const rec = await saveActivation({
      active: input.active,
      expiresAt: input.expiresAt,
      keyLast4: input.keyLast4,
      licenseKeyId: input.licenseKeyId,

      lastDeniedCode: null,
      lastDeniedMessage: null,
      lastDeniedAt: null,
    });
    setRecord(rec);
  };

  const setDeniedFn = async (input: { code: string | null; message: string | null }) => {
    const rec = await saveDenied({ code: input.code, message: input.message });
    setRecord(rec);
  };

  const clearDeniedFn = async () => {
    const rec = await clearDenied();
    setRecord(rec);
  };

  const clear = async () => {
    await clearActivation();
    await refresh();
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ActivationState>(() => {
    const isActiveNow = isActivationValidNow(record);
    return {
      isLoaded,

      active: record.active,
      expiresAt: record.expiresAt,
      keyLast4: record.keyLast4,
      licenseKeyId: record.licenseKeyId,

      lastDeniedCode: record.lastDeniedCode,
      lastDeniedMessage: record.lastDeniedMessage,
      lastDeniedAt: record.lastDeniedAt,

      isActiveNow,

      refresh,
      applyActivation,
      setDenied: setDeniedFn,
      clearDenied: clearDeniedFn,
      clear,
    };
  }, [isLoaded, record, tick]);

  return <ActivationContext.Provider value={value}>{children}</ActivationContext.Provider>;
}

export function useActivation() {
  const ctx = useContext(ActivationContext);
  if (!ctx) throw new Error("useActivation must be used within ActivationProvider");
  return ctx;
}
