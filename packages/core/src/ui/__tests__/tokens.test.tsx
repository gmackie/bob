/**
 * Token resolution smoke tests for theme × mode combinations.
 *
 * Strategy A (preferred): inject `tooling/tailwind/theme.css` into jsdom's
 * <head> and assert getComputedStyle resolves --color-accent per
 * (data-theme, data-mode) combo.
 *
 * jsdom's CSS support is partial — if getComputedStyle returns "" for the
 * custom property, tests will be ported to strategy B (string-content
 * matching against the raw theme.css). See the test header comment if/when
 * that fallback is needed.
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
  document.documentElement.removeAttribute("data-mode");
});

function getAccent(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();
}

describe("@gmacko/ui token resolution", () => {
  it("bob + light → --color-accent is #D4850A", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="light">
        <div />
      </ThemeProvider>,
    );
    expect(getAccent().toLowerCase()).toBe("#d4850a");
  });

  it("bob + dark → --color-accent is #E8A33C", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="dark">
        <div />
      </ThemeProvider>,
    );
    expect(getAccent().toLowerCase()).toBe("#e8a33c");
  });

  it("ooda + light → --color-accent is #d4a04a", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="light">
        <div />
      </ThemeProvider>,
    );
    expect(getAccent().toLowerCase()).toBe("#d4a04a");
  });

  it("ooda + dark → --color-accent is #d4a04a", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="dark">
        <div />
      </ThemeProvider>,
    );
    expect(getAccent().toLowerCase()).toBe("#d4a04a");
  });
});
