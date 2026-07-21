import type { Mode, ResolvedMode, Theme } from "./theme-provider";

export const THEME_STORAGE_KEY = "gmacko-theme";
export const MODE_STORAGE_KEY = "gmacko-mode";

const THEMES = new Set<Theme>(["ooda", "bob"]);
const MODES = new Set<Mode>(["light", "dark", "system"]);

export function isTheme(value: string): value is Theme {
  return THEMES.has(value as Theme);
}

export function isMode(value: string): value is Mode {
  return MODES.has(value as Mode);
}

export function resolveSystemMode(): ResolvedMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveMode(mode: Mode): ResolvedMode {
  return mode === "system" ? resolveSystemMode() : mode;
}

export function readStoredTheme(fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && isTheme(raw)) return raw;
  } catch {
    // localStorage may be unavailable
  }
  return fallback;
}

export function readStoredMode(fallback: Mode): Mode {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw && isMode(raw)) return raw;
  } catch {
    // localStorage may be unavailable
  }
  return fallback;
}

export function applyThemeToDocument({
  theme,
  mode,
  resolvedMode,
}: {
  theme: Theme;
  mode: Mode;
  resolvedMode: ResolvedMode;
}) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.remove("light", "dark", "auto");
  if (mode === "system") {
    root.classList.add("auto", resolvedMode);
  } else {
    root.classList.add(resolvedMode);
  }
  root.style.colorScheme = resolvedMode;
}

/**
 * Inline script injected before paint to avoid a flash of the wrong theme.
 * Keep in sync with applyThemeToDocument().
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var m=localStorage.getItem("${MODE_STORAGE_KEY}")||"system";var theme=t==="ooda"?"ooda":"bob";var resolved=m;if(m==="system"){resolved=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var root=document.documentElement;root.setAttribute("data-theme",theme);root.classList.remove("light","dark","auto");if(m==="system"){root.classList.add("auto",resolved);}else{root.classList.add(resolved);}root.style.colorScheme=resolved;}catch(e){}})();`;
