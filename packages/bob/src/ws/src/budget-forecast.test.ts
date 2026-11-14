import { describe, expect, it } from "vitest";

import { estimateAccountRates, weightedTokens, type ForecastLedgerRow, type ForecastMeterSample, type ForecastSession } from "./budget-forecast";

const NOW = new Date("2026-11-14T20:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RESET = "2026-11-15T12:00:00.000Z";
const tokens = (input: number, output = 0) => ({ input, output, reasoning: 0, cacheRead: 0, cacheCreation: 0, total: input + output });

describe("weightedTokens", () => {
  it("weights output and cache creation above input and cache reads far below", () => {
    expect(weightedTokens({ input: 100, output: 100, reasoning: 0, cacheRead: 1000, cacheCreation: 100, total: 1300 })).toBe(100 + 500 + 100 + 125);
  });
});

describe("estimateAccountRates", () => {
  const meters: ForecastMeterSample[] = [
    { usedPercent: 30, resetsAt: RESET, observedAt: ago(24) },
    { usedPercent: 54, resetsAt: RESET, observedAt: ago(0) },
  ];

  it("splits the measured burn rate by each source's share of weighted tokens", () => {
    // 24 points in 24h = 1 %/h, of which interactive used a quarter of the tokens.
    const ledger: ForecastLedgerRow[] = [
      { hour: ago(10), source: "interactive", tokens: tokens(250) },
      { hour: ago(5), source: "bob", tokens: tokens(750) },
    ];
    const sessions: ForecastSession[] = [{ firstAt: ago(6), lastAt: ago(5), tokens: tokens(750) }];
    const r = estimateAccountRates({ meters, ledger, sessions, now: NOW });
    expect(r.burnPctPerHour).toBeCloseTo(1, 5);
    expect(r.interactivePctPerHour).toBeCloseTo(0.25, 5);
    expect(r.pctPerWeightedToken).toBeCloseTo(24 / 1000, 8);
    expect(r.estimated).toBe(false);
  });

  it("prices a typical Bob run from its weighted tokens and takes the median duration", () => {
    const ledger: ForecastLedgerRow[] = [{ hour: ago(5), source: "bob", tokens: tokens(1000) }];
    const sessions: ForecastSession[] = [
      { firstAt: ago(6), lastAt: ago(5.5), tokens: tokens(100) },
      { firstAt: ago(4), lastAt: ago(3), tokens: tokens(200) },
      { firstAt: ago(3), lastAt: ago(1), tokens: tokens(400) },
    ];
    const r = estimateAccountRates({ meters, ledger, sessions, now: NOW });
    expect(r.costPerRunPct).toBeCloseTo(200 * (24 / 1000), 8);
    expect(r.runHours).toBeCloseTo(1, 8);
  });

  it("ignores meter pairs from different weekly windows and falls back, marked estimated", () => {
    const split: ForecastMeterSample[] = [
      { usedPercent: 90, resetsAt: "2026-11-14T12:00:00.000Z", observedAt: ago(24) },
      { usedPercent: 5, resetsAt: RESET, observedAt: ago(0) },
    ];
    const r = estimateAccountRates({ meters: split, ledger: [], sessions: [], now: NOW, fallbacks: { costPerRunPct: 1.5, runHours: 0.5, interactivePctPerHour: 0.1 } });
    expect(r.estimated).toBe(true);
    expect(r.costPerRunPct).toBe(1.5);
    expect(r.interactivePctPerHour).toBe(0.1);
    expect(r.runHours).toBe(0.5);
  });

  it("treats an idle account (no tokens, flat meter) as no interactive use rather than a guess", () => {
    const flat: ForecastMeterSample[] = [
      { usedPercent: 40, resetsAt: RESET, observedAt: ago(20) },
      { usedPercent: 40, resetsAt: RESET, observedAt: ago(0) },
    ];
    const r = estimateAccountRates({ meters: flat, ledger: [], sessions: [], now: NOW });
    expect(r.burnPctPerHour).toBe(0);
    expect(r.interactivePctPerHour).toBe(0);
  });
});
