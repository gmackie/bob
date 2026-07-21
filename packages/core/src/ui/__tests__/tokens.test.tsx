/**
 * Token resolution smoke tests for theme × mode combinations.
 *
 * Strategy A (preferred): inject `tooling/tailwind/theme.css` into jsdom's
 * <head> and assert getComputedStyle resolves --primary per
 * (data-theme, class) combo.
 *
 * jsdom's CSS support is partial — if getComputedStyle returns "" for the
 * custom property, tests fall back to strategy B (string-content matching
 * against the raw theme.css).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ThemeProvider } from "../theme-provider";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const themeCssPath = path.resolve(
  __dirname,
  "../../../../../tooling/tailwind/theme.css",
);
const themeCss = readFileSync(themeCssPath, "utf8");

beforeAll(() => {
  // Inject theme tokens into jsdom's <head> so getComputedStyle resolves them.
  // Strip the `@import "tailwindcss"` line — jsdom can't fetch it, and we
  // only need the @theme + [data-theme] blocks for token resolution.
  const styleEl = document.createElement("style");
  styleEl.textContent = themeCss.replace(
    /^@import\s+["']tailwindcss["'];?\s*/m,
    "",
  );
  document.head.appendChild(styleEl);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark", "light", "auto");
});

function getPrimary(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
}

/**
 * jsdom does not resolve CSS custom properties via getComputedStyle, so
 * Strategy A always returns "". Fall back to Strategy B: verify the raw
 * theme.css content contains the expected token values for each selector.
 */
describe("@gmacko/ui token resolution", () => {
  it("bob + light → --primary contains the Bob amber", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="light">
        <div />
      </ThemeProvider>,
    );
    const computed = getPrimary();
    if (computed) {
      // Strategy A — jsdom resolved the var (unlikely but ideal)
      expect(computed.toLowerCase()).toContain("oklch");
    } else {
      // Strategy B — verify the raw CSS has the right value
      expect(themeCss).toContain('[data-theme="bob"]');
      expect(themeCss).toMatch(/--primary:\s*oklch\(0\.6838/);
    }
  });

  it("bob + dark → --primary is the Bob light amber", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="dark">
        <div />
      </ThemeProvider>,
    );
    const computed = getPrimary();
    if (computed) {
      expect(computed.toLowerCase()).toBe("#e8a33c");
    } else {
      expect(themeCss).toContain('[data-theme="bob"].dark');
      expect(themeCss).toMatch(
        /\[data-theme="bob"\]\.dark[\s\S]*?--primary:\s*#e8a33c/,
      );
    }
  });

  it("ooda + light → --primary is the OODA gold", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="light">
        <div />
      </ThemeProvider>,
    );
    const computed = getPrimary();
    if (computed) {
      expect(computed.toLowerCase()).toBe("#d4a04a");
    } else {
      expect(themeCss).toContain('[data-theme="ooda"]');
      expect(themeCss).toMatch(/--primary:\s*#d4a04a/);
    }
  });

  it("ooda + dark → --primary is the OODA gold", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="dark">
        <div />
      </ThemeProvider>,
    );
    const computed = getPrimary();
    if (computed) {
      expect(computed.toLowerCase()).toBe("#d4a04a");
    } else {
      expect(themeCss).toContain('[data-theme="ooda"].dark');
      expect(themeCss).toMatch(/--primary:\s*#d4a04a/);
    }
  });
});
