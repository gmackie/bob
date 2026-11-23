import { describe, expect, it } from "vitest";

import { DEFAULT_BUDGET_POLICY, governState, type BudgetStateWire } from "@bob/ws";

import { buildGauges, buildRiver, decisionLines, impactOf, policyChanges } from "../budget-model";

const NOW = new Date("2026-11-14T20:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RESET = "2026-11-15T12:00:00.000Z";

const state: BudgetStateWire = {
  at: NOW.toISOString(),
  policy: DEFAULT_BUDGET_POLICY,
  accounts: [
    { accountId: "claude-a", provider: "claude", label: "m…@x.com", status: "ready", authIndex: "a1", updatedAt: NOW.toISOString() },
    { accountId: "claude-b", provider: "claude", label: "g…@x.com", status: "error", detail: "invalid grant", authIndex: "a2", updatedAt: NOW.toISOString() },
    { accountId: "kimi", provider: "kimi", label: "k…@x.com", status: "ready", updatedAt: NOW.toISOString() },
  ],
  meters: [
    { accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: 30, resetsAt: RESET, observedAt: ago(24) },
    { accountId: "claude-a", window: "weekly", windowMinutes: 10_080, usedPercent: 47, resetsAt: RESET, observedAt: ago(0.1) },
  ],
  ledger: [],
  sessions: [],
  activeByProvider: {},
};

describe("buildGauges", () => {
  const { verdict, assembled } = governState(state, NOW);
  const gauges = buildGauges(state, assembled, verdict, NOW);

  it("stacks used, forecast interactive and Bob's spendable budget without passing 100%", () => {
    const g = gauges.find((x) => x.accountId === "claude-a")!;
    expect(g.usedPct).toBeCloseTo(47, 5);
    expect(g.usedPct + g.interactivePct + g.bobPct).toBeLessThanOrEqual(100);
    expect(g.resetLabel).toMatch(/^resets /);
    expect(g.observedLabel).toBe("read 6m ago");
  });

  it("flags a broken account and an unmetered one distinctly", () => {
    expect(gauges.find((x) => x.accountId === "claude-b")).toMatchObject({ tone: "down", headline: "Needs attention" });
    expect(gauges.find((x) => x.accountId === "claude-b")!.reasons).toContain("invalid grant");
    expect(gauges.find((x) => x.accountId === "kimi")).toMatchObject({ tone: "idle", headline: "Unmetered", resetLabel: "no meter" });
  });
});

describe("buildRiver", () => {
  it("places history on the weekly window and projects to reset, with a draft ghost", () => {
    const live = governState(state, NOW);
    const draft = governState(state, NOW, { ...DEFAULT_BUDGET_POLICY, reservePct: 0 });
    const [series] = buildRiver(state, live.assembled, live.verdict, NOW, draft.verdict);
    expect(series!.windowHours).toBe(168);
    expect(series!.nowT).toBeCloseTo(168 - 16, 5);
    expect(series!.history[0]).toEqual({ t: 0, pct: 0 });
    expect(series!.projection.at(-1)!.t).toBeCloseTo(168, 5);
    expect(series!.draftProjection!.at(-1)!.pct).toBeGreaterThanOrEqual(series!.projection.at(-1)!.pct);
  });
});

describe("policyChanges / impactOf", () => {
  it("names each changed lever and summarises the predicted effect", () => {
    const draftPolicy = { ...DEFAULT_BUDGET_POLICY, reservePct: 5, mode: "boost" as const };
    expect(policyChanges(DEFAULT_BUDGET_POLICY, draftPolicy)).toEqual([
      { key: "mode", label: "Mode", from: "run", to: "boost" },
      { key: "reservePct", label: "Interactive reserve", from: "15%", to: "5%" },
    ]);
    const live = governState(state, NOW).verdict;
    const draft = governState(state, NOW, draftPolicy).verdict;
    const impact = impactOf(live, draft);
    expect(impact.landing.find((l) => l.accountId === "claude-a")!.to).toBeGreaterThan(impact.landing.find((l) => l.accountId === "claude-a")!.from);
    expect(impact.sentence).toContain("claude-a");
  });
});

describe("decisionLines", () => {
  it("says what shadow mode would have done next to legacy pacing", () => {
    const [line] = decisionLines([
      { id: 1, decidedAt: NOW.toISOString(), enforce: false, mode: "run", totalSlots: 3, legacyBudget: 1, byProvider: { claude: { slots: 1 }, codex: { slots: 2 } }, reasons: [{ accountId: "claude-b", reasons: ["account error"], slots: 0 }] },
    ]);
    expect(line!.headline).toBe("Would allow 3 runs · Claude 1, Codex 2 (legacy pacing: 1)");
    expect(line!.details).toEqual(["claude-b: account error"]);
  });
});
