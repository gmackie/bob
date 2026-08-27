import { describe, expect, it } from "vitest";

import {
  DEFAULT_HOME_MODE,
  HOME_MODE_STORAGE_KEY,
  defaultPhoneTab,
  defaultTabletShellMode,
  parseHomeMode,
  phoneTabOrder,
  tabletModeOrder,
} from "./home-mode-model";

describe("home-mode-model", () => {
  it("defaults to ooda-first and uses the bob.homeMode key", () => {
    expect(DEFAULT_HOME_MODE).toBe("ooda-first");
    expect(HOME_MODE_STORAGE_KEY).toBe("bob.homeMode");
  });

  it("parseHomeMode accepts canonical values and tolerant aliases", () => {
    expect(parseHomeMode("ooda-first")).toBe("ooda-first");
    expect(parseHomeMode("bob-first")).toBe("bob-first");
    expect(parseHomeMode(" BOB-FIRST ")).toBe("bob-first");
    expect(parseHomeMode("bob")).toBe("bob-first");
    expect(parseHomeMode("ooda")).toBe("ooda-first");
  });

  it("parseHomeMode falls back to the default for junk", () => {
    expect(parseHomeMode(null)).toBe("ooda-first");
    expect(parseHomeMode(undefined)).toBe("ooda-first");
    expect(parseHomeMode(42)).toBe("ooda-first");
    expect(parseHomeMode("")).toBe("ooda-first");
    expect(parseHomeMode("something-else")).toBe("ooda-first");
    expect(parseHomeMode({ mode: "bob-first" })).toBe("ooda-first");
  });

  it("defaultTabletShellMode maps modes", () => {
    expect(defaultTabletShellMode("ooda-first")).toBe("ooda");
    expect(defaultTabletShellMode("bob-first")).toBe("tasks");
  });

  it("tabletModeOrder orders the three modes", () => {
    expect(tabletModeOrder("ooda-first")).toEqual(["ooda", "planning", "tasks"]);
    expect(tabletModeOrder("bob-first")).toEqual(["tasks", "planning", "ooda"]);
  });

  it("phoneTabOrder keeps inbox first and swaps the rest", () => {
    expect(phoneTabOrder("ooda-first")).toEqual(["inbox", "ooda", "bob"]);
    expect(phoneTabOrder("bob-first")).toEqual(["inbox", "bob", "ooda"]);
  });

  it("defaultPhoneTab is always inbox", () => {
    expect(defaultPhoneTab("ooda-first")).toBe("inbox");
    expect(defaultPhoneTab("bob-first")).toBe("inbox");
  });
});
