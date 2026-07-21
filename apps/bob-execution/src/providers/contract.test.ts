import { describe, expect, it } from "vitest";

import {
  isProviderUsageStale,
  normalizeProviderUsage,
  providerIds,
  selectProviderUsage,
} from "./contract.js";

describe("provider contract", () => {
  it("supports the four mission-control providers", () => {
    expect(providerIds).toEqual(["claude", "codex", "grok", "cursor-agent"]);
  });

  it("keeps unavailable provider limits distinct from Bob-observed usage", () => {
    const snapshot = normalizeProviderUsage({
      provider: "grok",
      collectedAt: "2026-07-11T18:00:00.000Z",
      observed: { inputTokens: 120, outputTokens: 30, runCount: 2 },
    });

    expect(snapshot.allowance).toEqual({ status: "unavailable", source: "provider" });
    expect(snapshot.observed).toMatchObject({
      source: "bob_metered",
      inputTokens: 120,
      outputTokens: 30,
      runCount: 2,
    });
  });

  it("prefers provider-reported usage over estimates", () => {
    const selected = selectProviderUsage([
      { source: "estimated", inputTokens: 100, outputTokens: 20 },
      { source: "bob_metered", inputTokens: 90, outputTokens: 18 },
      { source: "provider", inputTokens: 80, outputTokens: 16 },
    ]);

    expect(selected?.source).toBe("provider");
  });

  it("marks snapshots stale from their collection time", () => {
    expect(
      isProviderUsageStale(
        { collectedAt: "2026-07-11T18:00:00.000Z" },
        new Date("2026-07-11T18:06:00.000Z"),
        5 * 60_000,
      ),
    ).toBe(true);
  });
});
