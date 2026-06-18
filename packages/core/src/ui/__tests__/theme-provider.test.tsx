import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../theme-provider";

let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
let mediaQueryMatches = false;

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: mediaQueryMatches,
      media: query,
      onchange: null,
      addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
        if (event === "change") mediaQueryListener = listener;
      }),
      removeEventListener: vi.fn(() => {
        mediaQueryListener = null;
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("light", "dark");
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  mediaQueryListener = null;
  mediaQueryMatches = false;
});

function ThemeConsumer() {
  const { theme, setTheme, mode, setMode, resolvedMode } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved-mode">{resolvedMode}</span>
      <button onClick={() => setTheme("bob")}>SwitchTheme</button>
      <button onClick={() => setMode("dark")}>SwitchMode</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("provides default theme", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("ooda");
  });

  it("switches themes", () => {
    render(
      <ThemeProvider defaultTheme="ooda" defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("SwitchTheme"));
    expect(screen.getByTestId("theme").textContent).toBe("bob");
  });

  it("sets data-theme=bob on <html> when defaultTheme is bob", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("bob");
  });

  it("sets .light class on <html> when defaultMode=light", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("resolved-mode").textContent).toBe("light");
  });

  it("sets .dark class on <html> when defaultMode=dark", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(screen.getByTestId("resolved-mode").textContent).toBe("dark");
  });

  it("resolves system mode via matchMedia (dark preference -> .dark class)", () => {
    mediaQueryMatches = true;
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("mode").textContent).toBe("system");
    expect(screen.getByTestId("resolved-mode").textContent).toBe("dark");
  });

  it("listens to media-query change events and flips dark/light class", () => {
    mediaQueryMatches = true;
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mediaQueryListener).toBeTruthy();
    act(() => {
      mediaQueryListener?.({ matches: false } as unknown as MediaQueryListEvent);
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByTestId("resolved-mode").textContent).toBe("light");
  });
});
