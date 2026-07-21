"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  MODE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredMode,
  readStoredTheme,
  resolveMode,
  resolveSystemMode,
} from "./theme-init";

export type Theme = "ooda" | "bob";
export type Mode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  resolvedMode: ResolvedMode;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme,
  defaultMode = "system",
}: {
  children: React.ReactNode;
  defaultTheme: Theme;
  defaultMode?: Mode;
}) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(defaultTheme),
  );
  const [mode, setModeState] = useState<Mode>(() =>
    readStoredMode(defaultMode),
  );
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    resolveMode(readStoredMode(defaultMode)),
  );

  // Track system-preference changes when mode === "system".
  useEffect(() => {
    if (mode !== "system") {
      setResolvedMode(mode);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    setResolvedMode(mql.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) =>
      setResolvedMode(e.matches ? "dark" : "light");
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  // Apply data-theme + dark/light/auto classes to <html>.
  useEffect(() => {
    applyThemeToDocument({ theme, mode, resolvedMode });
  }, [theme, mode, resolvedMode]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const setMode = useCallback((next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mode, setMode, resolvedMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
