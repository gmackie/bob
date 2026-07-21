import { describe, expect, it } from "vitest";

import { normalizeProviderCapacity } from "./provider-capacity";

describe("normalizeProviderCapacity", () => {
  it("keeps observed usage separate from unavailable provider allowance", () => {
    expect(normalizeProviderCapacity({
      provider: "claude",
      collectedAt: "2026-07-11T18:00:00.000Z",
      allowance: { status: "unavailable", source: "provider" },
      observed: { source: "bob_metered", inputTokens: 100, outputTokens: 20 },
    })).toEqual({
      provider: "claude",
      collectedAt: "2026-07-11T18:00:00.000Z",
      allowance: { status: "unavailable", source: "provider" },
      observed: { source: "bob_metered", inputTokens: 100, outputTokens: 20 },
    });
  });

  it("rejects a guessed remaining quota derived from Bob-metered usage", () => {
    expect(() => normalizeProviderCapacity({
      provider: "codex",
      collectedAt: "2026-07-11T18:00:00.000Z",
      allowance: { status: "available", source: "bob_metered", used: 10, limit: 100, unit: "percent" },
    })).toThrow("allowance must be provider-reported");
  });
});
