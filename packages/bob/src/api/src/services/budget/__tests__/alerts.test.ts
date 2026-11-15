import { describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({ db: {} }));

import { DEFAULT_BUDGET_POLICY, governState  } from "@bob/ws";
import type {BudgetStateWire} from "@bob/ws";

import { budgetAlerts } from "../alerts";

const NOW = new Date("2026-11-14T20:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RESET = "2026-11-15T12:00:00.000Z"; // 16h away

function state(meters: [number, number][], active = 0): BudgetStateWire {
  return {
    at: NOW.toISOString(),
    policy: DEFAULT_BUDGET_POLICY,
    accounts: [{ accountId: "claude-a", provider: "claude", label: "m…@x.com", status: "ready", authIndex: "a1", updatedAt: NOW.toISOString() }],
    meters: meters.map(([h, pct]) => ({ accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: pct, resetsAt: RESET, observedAt: ago(h) })),
    ledger: [],
    sessions: [],
    activeByProvider: { claude: active },
  };
}

const run = (s: BudgetStateWire) => {
  const { verdict, assembled } = governState(s, NOW);
  return budgetAlerts(s, verdict, assembled);
};

describe("budgetAlerts", () => {
  it("warns when the current pace leaves a week mostly unspent close to reset", () => {
    // 1 point/h for 16h from 47% → ~63%, far under the 98% target.
    const alerts = run(state([[24, 23], [0, 47]]));
    expect(alerts).toEqual([
      expect.objectContaining({ type: "budget_projected_miss", accountId: "claude-a", title: "Claude m…@x.com will reset with ~35% unused" }),
    ]);
  });

  it("stays quiet when the pace will reach the target", () => {
    expect(run(state([[24, 20], [0, 70]])).filter((a) => a.type === "budget_projected_miss")).toEqual([]);
  });

  it("flags Bob runs inside the reserve", () => {
    const alerts = run(state([[24, 60], [0, 90]], 2));
    expect(alerts.map((a) => a.type)).toContain("budget_reserve_breach");
  });
});
