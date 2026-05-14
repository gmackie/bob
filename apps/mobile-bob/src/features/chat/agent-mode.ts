import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AgentMode = "bob" | "ooda";

export const AGENT_MODE_STORAGE_KEY = "bob:agent-chat-mode";

interface AgentModeStorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

export function normalizeAgentMode(value: string | null | undefined): AgentMode {
  return value === "ooda" ? "ooda" : "bob";
}

export function toggleAgentMode(mode: AgentMode): AgentMode {
  return mode === "bob" ? "ooda" : "bob";
}

export function createAgentModeStorage(adapter: AgentModeStorageAdapter) {
  return {
    async get(): Promise<AgentMode> {
      return normalizeAgentMode(await adapter.getItem(AGENT_MODE_STORAGE_KEY));
    },
    async set(mode: AgentMode): Promise<void> {
      await adapter.setItem(AGENT_MODE_STORAGE_KEY, mode);
    },
  };
}

const defaultStorage = createAgentModeStorage(AsyncStorage);

export function useAgentMode() {
  const [mode, setModeState] = useState<AgentMode>("bob");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void defaultStorage
      .get()
      .then((storedMode) => {
        if (!cancelled) setModeState(storedMode);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((nextMode: AgentMode) => {
    setModeState(nextMode);
    void defaultStorage.set(nextMode);
  }, []);

  return useMemo(
    () => ({
      mode,
      isLoading,
      setMode,
      toggleMode: () => setMode(toggleAgentMode(mode)),
    }),
    [isLoading, mode, setMode],
  );
}
