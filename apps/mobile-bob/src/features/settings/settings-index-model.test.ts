/**
 * The settings index.
 *
 * Settings was a single 742-line scroll of six inline sections, and per-type
 * notifications add roughly eighteen more controls. A flat list stops being
 * navigable well before that: you cannot deep-link to one setting, and finding
 * anything means scrolling past everything.
 *
 * So the index is rows that push to sub-screens, and each row carries a value
 * summary — the point of an index is answering "what is this set to?" without
 * opening it.
 */
import { describe, expect, it } from "vitest";

import { buildSettingsIndex } from "./settings-index-model";

const base = {
  workspaceName: "hetzner-bob",
  notificationSummary: "Blocking events only",
  providerReadyCount: 4,
  providerTotalCount: 4,
  apiKeyCount: 14,
  theme: "system" as const,
};

describe("buildSettingsIndex", () => {
  it("puts the rows a person changes most at the top", () => {
    expect(buildSettingsIndex(base).map((r) => r.key)).toEqual([
      "account",
      "workspace",
      "notifications",
      "providers",
      "apiKeys",
      "appearance",
    ]);
  });

  it("shows each row's current value, so the index answers questions on its own", () => {
    const rows = buildSettingsIndex(base);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    expect(byKey.workspace).toBe("hetzner-bob");
    expect(byKey.notifications).toBe("Blocking events only");
    expect(byKey.apiKeys).toBe("14 keys");
    expect(byKey.appearance).toBe("System");
  });

  it("flags providers that need attention rather than only counting them", () => {
    // "4 ready" and "2 of 4 ready" are different situations; the index is
    // where an operator notices the second one.
    const healthy = buildSettingsIndex(base).find((r) => r.key === "providers")!;
    const degraded = buildSettingsIndex({ ...base, providerReadyCount: 2 }).find(
      (r) => r.key === "providers",
    )!;

    expect(healthy.value).toBe("4 ready");
    expect(healthy.needsAttention).toBe(false);
    expect(degraded.value).toBe("2 of 4 ready");
    expect(degraded.needsAttention).toBe(true);
  });

  it("uses the singular for one key", () => {
    expect(
      buildSettingsIndex({ ...base, apiKeyCount: 1 }).find((r) => r.key === "apiKeys")!.value,
    ).toBe("1 key");
  });

  it("gives every row a route, since a row that goes nowhere is not a row", () => {
    for (const row of buildSettingsIndex(base)) {
      expect(row.href).toMatch(/^\/settings\//);
    }
  });
});
