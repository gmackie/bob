import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_POLICY, type BudgetStateWire } from "@bob/ws";

import { buildBudgetGlance } from "./budget-glance-model";

const NOW = new Date("2026-11-14T20:00:00Z");
const state = (over: Partial<BudgetStateWire> = {}): BudgetStateWire => ({
  at: NOW.toISOString(),
  policy: DEFAULT_BUDGET_POLICY,
  accounts: [
    { accountId: "claude-a", provider: "claude", label: "m…@x.com", status: "ready", authIndex: "a1", updatedAt: NOW.toISOString() },
    { accountId: "claude-b", provider: "claude", label: "g…@x.com", status: "error", detail: "invalid grant", updatedAt: NOW.toISOString() },
    { accountId: "kimi", provider: "kimi", label: "k…@x.com", status: "ready", updatedAt: NOW.toISOString() },
  ],
  meters: [{ accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: 47, resetsAt: "2026-11-15T12:00:00.000Z", observedAt: NOW.toISOString() }],
  ledger: [],
  sessions: [],
  activeByProvider: {},
  ...over,
});

describe("buildBudgetGlance", () => {
  it("summarises each subscription and flags the broken one", () => {
    const g = buildBudgetGlance(state(), NOW);
    expect(g.rows.map((r) => r.tone)).toEqual(["ok", "down", "idle"]);
    expect(g.rows[0]!.detail).toMatch(/^47% used · lands \d+% · resets in 16h$/);
    expect(g.needsYou).toEqual(["Claude · g…@x.com: invalid grant"]);
    expect(g.headline).toMatch(/cleared to start \(shadow\)$/);
  });

  it("says paused while a pause is in force, and run once it expires", () => {
    const paused = { ...DEFAULT_BUDGET_POLICY, mode: "pause" as const, modeUntil: "2026-11-14T22:00:00.000Z" };
    expect(buildBudgetGlance(state({ policy: paused }), NOW)).toMatchObject({ mode: "pause", modeUntil: "2026-11-14T22:00:00.000Z" });
    expect(buildBudgetGlance(state({ policy: paused }), new Date("2026-11-14T23:00:00Z")).mode).toBe("run");
  });
});
