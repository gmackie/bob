import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Button } from "../button";
import { ThemeProvider } from "../theme-provider";

const cases = [
  { theme: "bob", mode: "light" },
  { theme: "bob", mode: "dark" },
  { theme: "ooda", mode: "light" },
  { theme: "ooda", mode: "dark" },
] as const;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

// These snapshots capture the Button's rendered DOM + classNames. They do NOT
// capture computed styles — jsdom does not resolve Tailwind utility classes
// into CSS, and the theme tokens (`var(--color-accent)` etc.) are swapped at
// the CSS layer via `data-theme`/`data-mode` on <html>, which lives outside
// the asFragment() output.
//
// Result: all 4 snapshots will be IDENTICAL. That is correct and expected.
// Their value is as a regression guard — if a future change hardcodes a color
// into the Button class string (instead of consuming a token var), or swaps
// classes per theme, the snapshots would diverge across cases and surface the
// drift.
describe("Button snapshot under theme x mode", () => {
  for (const { theme, mode } of cases) {
    it(`renders consistently for theme=${theme} mode=${mode}`, () => {
      const { asFragment } = render(
        <ThemeProvider defaultTheme={theme} defaultMode={mode}>
          <Button variant="default">Click me</Button>
        </ThemeProvider>,
      );
      expect(asFragment()).toMatchInlineSnapshot(`
        <DocumentFragment>
          <button
            class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50 bg-[var(--color-accent)] text-[var(--color-bg)] hover:bg-[var(--color-accent-hover)] h-9 px-4"
          >
            Click me
          </button>
        </DocumentFragment>
      `);
    });
  }
});
