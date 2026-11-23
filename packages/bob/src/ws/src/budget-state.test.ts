import { describe, expect, it } from "vitest";

import { DEFAULT_BUDGET_POLICY } from "./budget-governor";
import { assembleGovernorInputs, governState, type BudgetStateWire } from "./budget-state";

const NOW = new Date("2026-11-14T20:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const tokens = (n: number) => ({ input: n, output: 0, reasoning: 0, cacheRead: 0, cacheCreation: 0, total: n });

function state(over: Partial<BudgetStateWire> = {}): BudgetStateWire {
  return {
    at: NOW.toISOString(),
    policy: DEFAULT_BUDGET_POLICY,
    accounts: [
      { accountId: "claude-a", provider: "claude", label: "m…@x.com", status: "ready", authIndex: "a1", updatedAt: NOW.toISOString() },
      { accountId: "claude-b", provider: "claude", label: "g…@x.com", status: "error", detail: "invalid grant", authIndex: "a2", updatedAt: NOW.toISOString() },
      { accountId: "codex-a", provider: "codex", label: "m…@x.com", status: "ready", authIndex: "c1", updatedAt: NOW.toISOString() },
      { accountId: "codex-b", provider: "codex", label: "g…@x.com", status: "ready", authIndex: "c2", updatedAt: NOW.toISOString() },
      { accountId: "kimi", provider: "kimi", label: "kimi", status: "ready", updatedAt: NOW.toISOString() },
    ],
    meters: [
      { accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: 30, resetsAt: "2026-11-15T12:00:00.000Z", observedAt: ago(24) },
      { accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: 47, resetsAt: "2026-11-15T12:00:00.000Z", observedAt: ago(0) },
      { accountId: "codex-a", window: "weekly", windowMinutes: 10_080, usedPercent: 8, resetsAt: "2026-11-19T21:55:44.000Z", observedAt: ago(0) },
    ],
    ledger: [
      { hour: ago(3), authIndex: "a1", provider: "claude", model: "opus", source: "interactive", requests: 10, failed: 0, tokens: tokens(100) },
      { hour: ago(3), authIndex: "a1", provider: "claude", model: "opus", source: "bob", requests: 10, failed: 0, tokens: tokens(300) },
    ],
    sessions: [{ sessionId: "s1", authIndex: "a1", provider: "claude", model: "opus", requests: 4, tokens: tokens(40), firstAt: ago(2), lastAt: ago(1.5) }],
    activeByProvider: { claude: 2, codex: 3 },
    ...over,
  };
}

describe("assembleGovernorInputs", () => {
  it("joins meters by account and ledger and sessions by auth index", () => {
    const [claudeA] = assembleGovernorInputs(state(), NOW);
    expect(claudeA!.input.weekly).toMatchObject({ usedPercent: 47 });
    // 17 points in 24h, a quarter of the tokens interactive.
    expect(claudeA!.input.interactivePctPerHour).toBeCloseTo((17 / 24) * 0.25, 6);
    expect(claudeA!.input.costPerRunPct).toBeCloseTo(40 * (17 / 400), 6);
    expect(claudeA!.input.runHours).toBeCloseTo(0.5, 6);
  });

  it("spreads a provider's in-flight runs across its ready accounts only", () => {
    const byId = Object.fromEntries(assembleGovernorInputs(state(), NOW).map((a) => [a.input.accountId, a.input]));
    expect(byId["claude-a"]!.activeBobRuns).toBe(2);
    expect(byId["claude-b"]!.activeBobRuns).toBe(0);
    expect(byId["codex-a"]!.activeBobRuns + byId["codex-b"]!.activeBobRuns).toBe(3);
  });

  it("maps unknown statuses to error and leaves unmetered accounts without a weekly reading", () => {
    const assembled = assembleGovernorInputs(state({ accounts: [{ accountId: "x", provider: "grok", label: "x", status: "weird", updatedAt: NOW.toISOString() }] }), NOW);
    expect(assembled[0]!.input.status).toBe("error");
    expect(assembled[0]!.input.weekly).toBeUndefined();
  });
});

describe("governState", () => {
  it("previews a draft policy against the same snapshot", () => {
    const live = governState(state(), NOW).verdict;
    const paused = governState(state(), NOW, { ...DEFAULT_BUDGET_POLICY, mode: "pause" }).verdict;
    expect(paused.totalSlots).toBe(0);
    expect(live.accounts.find((a) => a.accountId === "claude-b")!.reasons).toContain("account error");
  });
});
