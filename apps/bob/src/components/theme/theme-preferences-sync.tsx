"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Mode } from "@gmacko/core/ui/theme";
import { useTheme } from "@gmacko/core/ui/theme";

import { useBobRpcClient } from "~/rpc/react";

type UserPreferences = {
  theme?: Mode;
};

const preferencesQueryKey = ["rpc", "settings.getPreferences"] as const;

/**
 * Applies the signed-in user's saved theme preference to ThemeProvider on load,
 * keeping server settings and client localStorage in sync.
 */
export function ThemePreferencesSync() {
  const rpc = useBobRpcClient();
  const { mode, setMode } = useTheme();
  const syncedPreference = useRef<Mode | null>(null);

  const { data: preferences } = useQuery({
    queryKey: preferencesQueryKey,
    queryFn: () => rpc.settings.getPreferences() as Promise<UserPreferences>,
    staleTime: 60_000,
  });

  useEffect(() => {
    const savedTheme = preferences?.theme;
    if (!savedTheme || syncedPreference.current === savedTheme) return;

    syncedPreference.current = savedTheme;
    if (mode !== savedTheme) {
      setMode(savedTheme);
    }
  }, [mode, preferences?.theme, setMode]);

  return null;
}
