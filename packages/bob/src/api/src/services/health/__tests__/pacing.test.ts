import { describe, expect, it } from "vitest";

import { paceDailyBudget } from "../pacing";

describe("paceDailyBudget", () => {
  it("at midnight only the burst is available", () => {
    expect(paceDailyBudget({ dailyCap: 40, executeToday: 0, minuteOfDay: 0, burst: 4 })).toEqual({ allowance: 4, earned: 0, pacingBinds: true });
  });
  it("earns the pro-rata share as the day goes on (noon = half the cap, plus burst)", () => {
    const v = paceDailyBudget({ dailyCap: 40, executeToday: 10, minuteOfDay: 720, burst: 4 });
    expect(v.earned).toBe(20);
    expect(v.allowance).toBe(14);
    expect(v.pacingBinds).toBe(true);
  });
  it("never shuts the pipe mid-day when the morning was busy: allowance narrows to the burst rate", () => {
    // 40 cap, 24 already run by 11:20 → pro-rata earned 19, burst 4 → 0 now...
    const early = paceDailyBudget({ dailyCap: 40, executeToday: 24, minuteOfDay: 680, burst: 4 });
    expect(early.allowance).toBe(0);
    // ...but a little later the line catches up and dispatch resumes, one or two at a time.
    const later = paceDailyBudget({ dailyCap: 40, executeToday: 24, minuteOfDay: 800, burst: 4 });
    expect(later.earned).toBe(23);
    expect(later.allowance).toBe(3);
  });
  it("carries unused share forward within the day", () => {
    const v = paceDailyBudget({ dailyCap: 40, executeToday: 2, minuteOfDay: 1200, burst: 4 });
    expect(v.earned).toBe(34);
    expect(v.allowance).toBe(36);
  });
  it("the hard cap is still the ceiling", () => {
    const v = paceDailyBudget({ dailyCap: 40, executeToday: 39, minuteOfDay: 1439, burst: 4 });
    expect(v.allowance).toBe(1);
    expect(v.pacingBinds).toBe(false);
    expect(paceDailyBudget({ dailyCap: 40, executeToday: 40, minuteOfDay: 1439, burst: 4 }).allowance).toBe(0);
  });
  it("handles a zero cap and clamps odd inputs", () => {
    expect(paceDailyBudget({ dailyCap: 0, executeToday: 0, minuteOfDay: 500, burst: 4 }).allowance).toBe(0);
    expect(paceDailyBudget({ dailyCap: 40, executeToday: 0, minuteOfDay: 99999, burst: -1 }).earned).toBe(40);
  });
});
