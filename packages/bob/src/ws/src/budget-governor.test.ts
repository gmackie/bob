import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUDGET_POLICY,
  governBudget,
  normalizeBudgetPolicy,
  paceWeight,
  type BudgetPolicy,
  type GovernorAccountInput,
} from "./budget-governor";

const NOW = new Date("2026-11-14T20:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function account(over: Partial<GovernorAccountInput> = {}): GovernorAccountInput {
  return {
    accountId: "claude-a",
    provider: "claude",
    status: "ready",
    weekly: { usedPercent: 40, resetsAt: hoursFromNow(98), observedAt: NOW.toISOString() },
    interactivePctPerHour: 0.1,
    costPerRunPct: 1,
    runHours: 0.5,
    activeBobRuns: 0,
    ...over,
  };
}

const policy = (over: Partial<BudgetPolicy> = {}): BudgetPolicy => ({ ...DEFAULT_BUDGET_POLICY, ...over });

describe("governBudget — pacing to the landing target", () => {
  it("spreads the spendable budget evenly until the landing buffer before reset", () => {
    // landing 98, used 40, reserve 15 (no release yet: 96h to run end > 12h),
    // interactive 0.1 %/h × 98h = 9.8 → spendable 33.2 over 96h.
    const verdict = governBudget([account()], policy(), NOW);
    const a = verdict.accounts[0]!;
    expect(a.spendablePct).toBeCloseTo(33.2, 5);
    expect(a.ratePctPerHour).toBeCloseTo(33.2 / 96, 5);
    // Little's law: concurrent runs = rate × run hours ÷ cost per run.
    expect(a.targetConcurrent).toBeCloseTo((33.2 / 96) * 0.5, 5);
    expect(a.projectedLandingPct).toBeCloseTo(98 - 15, 5);
  });

  it("turns the target into whole run slots, net of runs already in flight", () => {
    const busy = account({ costPerRunPct: 0.05, activeBobRuns: 2 });
    const a = governBudget([busy], policy(), NOW).accounts[0]!;
    expect(a.targetConcurrent).toBeCloseTo(((33.2 / 96) * 0.5) / 0.05, 5); // ≈3.46
    expect(a.slots).toBe(1); // floor(3.46) − 2
  });

  it("releases the reserve linearly over the final window", () => {
    // 2h buffer; 8h to run end inside a 12h window → 2/3 of the reserve released.
    const late = account({ weekly: { usedPercent: 80, resetsAt: hoursFromNow(10), observedAt: NOW.toISOString() } });
    const a = governBudget([late], policy(), NOW).accounts[0]!;
    expect(a.effectiveReservePct).toBeCloseTo(15 * (8 / 12), 5);
    expect(a.spendablePct).toBeCloseTo(98 - 80 - 10 - 0.1 * 10, 5);
  });

  it("gives nothing when your own forecast use already reaches the target", () => {
    const heavy = account({ interactivePctPerHour: 0.6 });
    const a = governBudget([heavy], policy(), NOW).accounts[0]!;
    expect(a.spendablePct).toBe(0);
    expect(a.slots).toBe(0);
    expect(a.reasons).toContain("no spendable budget before reset");
  });

  it("stops at the landing buffer: nothing starts in the last hours before reset", () => {
    const a = governBudget([account({ weekly: { usedPercent: 50, resetsAt: hoursFromNow(1.5), observedAt: NOW.toISOString() } })], policy(), NOW).accounts[0]!;
    expect(a.slots).toBe(0);
    expect(a.reasons).toContain("inside the landing buffer");
  });
});

describe("governBudget — guards", () => {
  it("pause gives zero everywhere", () => {
    const verdict = governBudget([account(), account({ accountId: "codex-a", provider: "codex" })], policy({ mode: "pause" }), NOW);
    expect(verdict.accounts.every((a) => a.slots === 0)).toBe(true);
    expect(verdict.totalSlots).toBe(0);
  });

  it("boost speeds up spending but never spends past the spendable budget", () => {
    const base = governBudget([account({ costPerRunPct: 0.05 })], policy(), NOW).accounts[0]!;
    const boosted = governBudget([account({ costPerRunPct: 0.05 })], policy({ mode: "boost", boostFactor: 2 }), NOW).accounts[0]!;
    expect(boosted.ratePctPerHour).toBeCloseTo(base.ratePctPerHour * 2, 5);
    expect(boosted.spendablePct).toBe(base.spendablePct);
  });

  it("an expired pause or boost falls back to run", () => {
    const verdict = governBudget([account()], policy({ mode: "pause", modeUntil: hoursFromNow(-1) }), NOW);
    expect(verdict.mode).toBe("run");
    expect(verdict.accounts[0]!.ratePctPerHour).toBeGreaterThan(0);
  });

  it("the 5-hour ceiling zeroes an account whose short window is hot, when that window is metered", () => {
    const hot = account({ short: { usedPercent: 85, resetsAt: hoursFromNow(2), observedAt: NOW.toISOString() } });
    const a = governBudget([hot], policy(), NOW).accounts[0]!;
    expect(a.slots).toBe(0);
    expect(a.reasons.join(" ")).toMatch(/5h window at 85%/);
  });

  it("accounts cooling down, disabled, in error or turned off in policy get no slots", () => {
    const verdict = governBudget(
      [
        account({ accountId: "a", status: "cooldown" }),
        account({ accountId: "b", status: "error" }),
        account({ accountId: "c", status: "disabled" }),
        account({ accountId: "d" }),
      ],
      policy({ accounts: { d: { enabled: false } } }),
      NOW,
    );
    expect(verdict.accounts.map((a) => a.slots)).toEqual([0, 0, 0, 0]);
  });

  it("a stale meter is treated as more used than it says, and the verdict is marked estimated", () => {
    const fresh = governBudget([account()], policy(), NOW).accounts[0]!;
    const stale = governBudget(
      [account({ weekly: { usedPercent: 40, resetsAt: hoursFromNow(98), observedAt: hoursFromNow(-10) } })],
      policy(),
      NOW,
    ).accounts[0]!;
    expect(stale.estimated).toBe(true);
    // 10h of forecast interactive use plus the stale safety margin.
    expect(stale.usedPercent).toBeCloseTo(40 + 0.1 * 10 + DEFAULT_BUDGET_POLICY.staleMarginPct, 5);
    expect(stale.spendablePct).toBeLessThan(fresh.spendablePct);
  });

  it("an unmetered account gets the fixed fallback concurrency, marked estimated", () => {
    const kimi = account({ accountId: "kimi", provider: "kimi", weekly: undefined, activeBobRuns: 0 });
    const a = governBudget([kimi], policy({ unmeteredConcurrency: 1 }), NOW).accounts[0]!;
    expect(a.slots).toBe(1);
    expect(a.estimated).toBe(true);
    expect(a.reasons).toContain("no meter; fixed fallback concurrency");
  });

  it("a weekly reset already in the past is treated as a fresh week", () => {
    const passed = account({ weekly: { usedPercent: 95, resetsAt: hoursFromNow(-1), observedAt: hoursFromNow(-2), windowMinutes: 10_080 } });
    const a = governBudget([passed], policy(), NOW).accounts[0]!;
    expect(a.usedPercent).toBe(0);
    expect(a.reasons).toContain("reset passed since last reading");
  });
});

describe("governBudget — totals and properties", () => {
  it("sums slots per provider and caps the total at the concurrency cap", () => {
    const accounts = [
      account({ accountId: "c1", costPerRunPct: 0.01 }),
      account({ accountId: "c2", costPerRunPct: 0.01 }),
      account({ accountId: "x1", provider: "codex", costPerRunPct: 0.01 }),
    ];
    const verdict = governBudget(accounts, policy({ concurrencyCap: 10 }), NOW);
    expect(verdict.byProvider.claude!.slots + verdict.byProvider.codex!.slots).toBe(verdict.totalSlots);
    expect(verdict.totalSlots).toBeLessThanOrEqual(10);
  });

  it("never allows more spend than spendable and never a negative slot (property)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i += 1) {
      const a = account({
        weekly: { usedPercent: rand() * 100, resetsAt: hoursFromNow(rand() * 170 - 2), observedAt: hoursFromNow(-rand() * 12) },
        interactivePctPerHour: rand() * 0.5,
        costPerRunPct: 0.01 + rand() * 4,
        runHours: 0.1 + rand() * 2,
        activeBobRuns: Math.floor(rand() * 6),
        ...(rand() < 0.3 ? { short: { usedPercent: rand() * 100, observedAt: NOW.toISOString() } } : {}),
      });
      const p = policy({ reservePct: rand() * 40, landingPct: 50 + rand() * 50, mode: rand() < 0.2 ? "boost" : "run", boostFactor: 1 + rand() * 2 });
      const v = governBudget([a], p, NOW).accounts[0]!;
      expect(v.slots).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v.slots)).toBe(true);
      expect(v.spendablePct).toBeGreaterThanOrEqual(0);
      expect(v.ratePctPerHour * Math.max(0, v.hoursToRunEnd)).toBeLessThanOrEqual(v.spendablePct * (p.mode === "boost" ? p.boostFactor : 1) + 1e-9);
    }
  });
});

describe("paceWeight", () => {
  it("is flat for even pacing and favours weekday working hours for working-hours pacing", () => {
    expect(paceWeight("even", new Date("2026-11-16T03:00:00Z"), 0)).toBe(1);
    const work = paceWeight("working-hours", new Date("2026-11-16T15:00:00Z"), 0); // Mon 15:00 UTC
    const night = paceWeight("working-hours", new Date("2026-11-16T03:00:00Z"), 0);
    expect(work).toBeGreaterThan(night);
  });
});

describe("normalizeBudgetPolicy", () => {
  it("fills defaults, clamps values and keeps the stored tier order with delivery first", () => {
    const p = normalizeBudgetPolicy({
      reservePct: 500,
      mode: "sideways",
      tiers: [
        { tier: "bizpulse", enabled: false, maxShare: 0.5 },
        { tier: "delivery", enabled: false, maxShare: 0.1 },
        { tier: "groom", enabled: true, maxShare: 9 },
        { tier: "made-up", enabled: true, maxShare: 1 },
      ],
    });
    expect(p.reservePct).toBe(60);
    expect(p.mode).toBe("run");
    expect(p.enforce).toBe(false);
    expect(p.tiers.map((t) => t.tier)).toEqual(["delivery", "bizpulse", "groom", "pull-forward", "discovery"]);
    expect(p.tiers[0]).toEqual({ tier: "delivery", enabled: true, maxShare: 1 });
    expect(p.tiers[1]).toMatchObject({ enabled: false, maxShare: 0.5 });
    expect(p.tiers[2]!.maxShare).toBe(1);
  });

  it("treats garbage as the defaults", () => {
    expect(normalizeBudgetPolicy("nope")).toEqual(DEFAULT_BUDGET_POLICY);
  });
});
