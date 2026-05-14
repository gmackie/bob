import { describe, expect, it } from "vitest";

import {
  AGENT_MODE_STORAGE_KEY,
  createAgentModeStorage,
  normalizeAgentMode,
  toggleAgentMode,
} from "./agent-mode";

describe("agent mode state", () => {
  it("normalizes unknown stored values to Bob mode", () => {
    expect(normalizeAgentMode("ooda")).toBe("ooda");
    expect(normalizeAgentMode("bob")).toBe("bob");
    expect(normalizeAgentMode("unexpected")).toBe("bob");
    expect(normalizeAgentMode(null)).toBe("bob");
  });

  it("toggles between Bob and OODA", () => {
    expect(toggleAgentMode("bob")).toBe("ooda");
    expect(toggleAgentMode("ooda")).toBe("bob");
  });

  it("persists the selected mode through injected storage", async () => {
    const writes = new Map<string, string>();
    const storage = createAgentModeStorage({
      getItem: (key) => Promise.resolve(writes.get(key) ?? null),
      setItem: (key, value) => {
        writes.set(key, value);
        return Promise.resolve();
      },
    });

    await storage.set("ooda");

    expect(writes.get(AGENT_MODE_STORAGE_KEY)).toBe("ooda");
    await expect(storage.get()).resolves.toBe("ooda");
  });
});
