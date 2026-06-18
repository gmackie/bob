"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

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

const THEME_STORAGE_KEY = "gmacko-theme";
const MODE_STORAGE_KEY = "gmacko-mode";

function readStored<T extends string>(
  key: string,
  isValid: (s: string) => s is T,
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw && isValid(raw)) return raw;
  } catch {
    // localStorage may be unavailable
  }
  return fallback;
}

const isTheme = (s: string): s is Theme => s === "ooda" || s === "bob";
const isMode = (s: string): s is Mode =>
  s === "light" || s === "dark" || s === "system";

function resolveSystemMode(): ResolvedMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
    readStored(THEME_STORAGE_KEY, isTheme, defaultTheme),
  );
  const [mode, setModeState] = useState<Mode>(() =>
    readStored(MODE_STORAGE_KEY, isMode, defaultMode),
  );
  const [resolvedMode, setResolvedMode] = useState<ResolvedMode>(() =>
    mode === "system" ? resolveSystemMode() : mode,
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

  // Apply data-theme + dark/light class to <html>.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(resolvedMode);
  }, [theme, resolvedMode]);

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
