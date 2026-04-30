import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../theme-provider";
import { ThemeSwitcher } from "../theme-switcher";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
});

beforeEach(() => {
  localStorageMock.clear();
  // Default matchMedia stub — light preference. Individual tests may override.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("light", "dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSwitcher(defaultTheme: "ooda" | "bob" = "ooda") {
  return render(
    <ThemeProvider defaultTheme={defaultTheme}>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
}

describe("ThemeSwitcher", () => {
  it("renders both theme buttons", () => {
    renderSwitcher();
    expect(screen.getByText("OODA")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("switches to bob theme when Bob button is clicked", () => {
    renderSwitcher("ooda");
    fireEvent.click(screen.getByText("Bob"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("bob");
  });

  it("switches to ooda theme when OODA button is clicked", () => {
    renderSwitcher("bob");
    fireEvent.click(screen.getByText("OODA"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("ooda");
  });

  it("persists theme to localStorage", () => {
    renderSwitcher("ooda");
    fireEvent.click(screen.getByText("Bob"));
    expect(localStorageMock.getItem("gmacko-theme")).toBe("bob");
  });

  it("reads persisted theme from localStorage on mount", () => {
    localStorageMock.setItem("gmacko-theme", "bob");
    renderSwitcher("ooda"); // default is ooda, but localStorage has bob
    expect(document.documentElement.getAttribute("data-theme")).toBe("bob");
  });

  it("clicking 'Dark' sets mode to dark", () => {
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="light">
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("Dark"));
    // Mode change reflects in class on <html>
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("clicking 'System' sets mode to system (resolved from matchMedia)", () => {
    // Override default stub to return light preference explicitly.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    render(
      <ThemeProvider defaultTheme="bob" defaultMode="dark">
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText("System"));
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
