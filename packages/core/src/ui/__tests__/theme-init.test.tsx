import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  THEME_INIT_SCRIPT,
  applyThemeToDocument,
  isMode,
  isTheme,
  resolveMode,
} from "../theme-init";

describe("theme-init", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("light", "dark", "auto");
    document.documentElement.style.colorScheme = "";
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates theme and mode literals", () => {
    expect(isTheme("bob")).toBe(true);
    expect(isTheme("ooda")).toBe(true);
    expect(isTheme("light")).toBe(false);
    expect(isMode("system")).toBe(true);
    expect(isMode("dark")).toBe(true);
    expect(isMode("bob")).toBe(false);
  });

  it("applyThemeToDocument sets data-theme and resolved mode class", () => {
    applyThemeToDocument({
      theme: "bob",
      mode: "dark",
      resolvedMode: "dark",
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("bob");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("auto")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("applyThemeToDocument adds auto class when mode is system", () => {
    applyThemeToDocument({
      theme: "bob",
      mode: "system",
      resolvedMode: "light",
    });
    expect(document.documentElement.classList.contains("auto")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("resolveMode resolves system via matchMedia", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    expect(resolveMode("system")).toBe("dark");
    expect(resolveMode("light")).toBe("light");
  });

  it("THEME_INIT_SCRIPT applies stored theme without throwing", () => {
    localStorage.setItem("gmacko-theme", "bob");
    localStorage.setItem("gmacko-mode", "dark");
    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function(THEME_INIT_SCRIPT)();
    }).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("bob");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
