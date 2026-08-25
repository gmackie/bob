import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_HOME_MODE,
  HOME_MODE_STORAGE_KEY,
  parseHomeMode,
} from "~/features/shell/home-mode-model";
import type { HomeMode } from "~/features/shell/home-mode-model";

/** Read the persisted home mode for non-React callers (e.g. the index redirect). */
export async function getHomeModePreference(): Promise<HomeMode> {
  try {
    const raw = await AsyncStorage.getItem(HOME_MODE_STORAGE_KEY);
    return parseHomeMode(raw);
  } catch {
    return DEFAULT_HOME_MODE;
  }
}

export async function setHomeModePreference(mode: HomeMode): Promise<void> {
  await AsyncStorage.setItem(HOME_MODE_STORAGE_KEY, mode);
}

export interface HomeModePreference {
  mode: HomeMode;
  setMode: (mode: HomeMode) => Promise<void>;
  /** False until the persisted value has been read; `mode` is the default until then. */
  hydrated: boolean;
}

export function useHomeModePreference(): HomeModePreference {
  const [mode, setModeState] = useState<HomeMode>(DEFAULT_HOME_MODE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getHomeModePreference().then((stored) => {
      if (cancelled) return;
      setModeState(stored);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback(async (next: HomeMode) => {
    setModeState(next);
    await setHomeModePreference(next);
  }, []);

  return { mode, setMode, hydrated };
}
