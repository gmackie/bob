import { describe, expect, it } from "vitest";

import { costOfItems, costSummary, estimateItemPct, planWeeks, throughputByProject, type WorkItemCost } from "./budget-cost";
import type { AccountRates } from "./budget-forecast";

const tok = (input: number) => ({ input, output: 0, reasoning: 0, cacheRead: 0, cacheCreation: 0, total: input });
const rates = (pctPerWeightedToken?: number): AccountRates => ({
  burnPctPerHour: 1,
  interactivePctPerHour: 0.1,
  ...(pctPerWeightedToken !== undefined ? { pctPerWeightedToken } : {}),
  costPerRunPct: 1,
  runHours: 0.5,
  estimated: false,
  notes: [],
});

describe("costOfItems", () => {
  it("prices each account's share with that account's rate and sums them", () => {
    const [cost] = costOfItems(
      [{ workItemId: "w1", projectId: "p1", title: "T", status: "done", updatedAt: "2026-11-14T00:00:00Z", byAccount: [{ authIndex: "a1", sessions: 2, tokens: tok(1000) }, { authIndex: "c1", sessions: 1, tokens: tok(500) }] }],
      new Map([
        ["a1", rates(0.002)],
        ["c1", rates(0.004)],
      ]),
    );
    expect(cost!.pctOfWeek).toBeCloseTo(2 + 2, 8);
    expect(cost!.sessions).toBe(3);
    expect(cost!.tokens.total).toBe(1500);
    expect(cost!.estimated).toBe(false);
  });

  it("marks an item estimated when part of it ran on an uncalibrated account", () => {
    const [cost] = costOfItems(
      [{ workItemId: "w1", projectId: null, title: "T", status: "done", updatedAt: "2026-11-14T00:00:00Z", byAccount: [{ authIndex: "a1", sessions: 1, tokens: tok(1000) }, { authIndex: "x", sessions: 1, tokens: tok(9) }] }],
      new Map([["a1", rates(0.001)]]),
    );
    expect(cost!.pctOfWeek).toBeCloseTo(1, 8);
    expect(cost!.estimated).toBe(true);
  });
});

const done = (id: string, projectId: string | null, pct: number, updatedAt = "2026-11-13T00:00:00Z"): WorkItemCost => ({
  workItemId: id,
  projectId,
  title: id,
  status: "done",
  updatedAt,
  sessions: 1,
  tokens: tok(100),
  pctOfWeek: pct,
  estimated: false,
});

describe("throughputByProject", () => {
  it("counts this week's finished items and carries the planner's plan", () => {
    const rows = throughputByProject([done("a", "bob", 2), done("b", "bob", 4), done("c", "fg", 3, "2026-11-01T00:00:00Z")], new Date("2026-11-09T00:00:00Z"), new Map([["bob", 5], ["crucible", 2]]));
    const bob = rows.find((r) => r.projectId === "bob")!;
    expect(bob).toMatchObject({ done: 2, planned: 5, costPct: 6, medianItemPct: 3 });
    expect(rows.find((r) => r.projectId === "fg")).toMatchObject({ done: 0, costPct: 3 });
    expect(rows.find((r) => r.projectId === "crucible")).toMatchObject({ done: 0, planned: 2 });
  });
});

describe("estimateItemPct / planWeeks", () => {
  const history = [done("a", "bob", 2), done("b", "bob", 4), done("c", "bob", 3), done("d", "fg", 10)];

  it("prefers the project's own median, then everyone's, then the fallback", () => {
    expect(estimateItemPct("bob", history, 1)).toEqual({ pct: 3, basis: "project", samples: 3 });
    expect(estimateItemPct("fg", history, 1)).toMatchObject({ pct: 3.5, basis: "global" });
    expect(estimateItemPct("x", [], 1.5)).toEqual({ pct: 1.5, basis: "fallback", samples: 0 });
  });

  it("fills weeks in order, spills to later weeks and reports backlog depth", () => {
    const backlog = Array.from({ length: 7 }, (_, i) => ({ workItemId: `w${i}`, projectId: "bob", title: `w${i}`, status: "todo" }));
    const plan = planWeeks(backlog, [6, 9, 9], history, 1);
    expect(plan.weeks.map((w) => w.items.length)).toEqual([2, 3, 2]);
    expect(plan.weeks[0]!.byProject).toEqual({ bob: 2 });
    expect(plan.overflow).toBe(0);
    expect(plan.depthWeeks).toBeCloseTo(1 + 1 + 6 / 9, 6);
  });

  it("never drops an item bigger than a whole week", () => {
    const plan = planWeeks([{ workItemId: "huge", projectId: "fg", title: "huge", status: "todo" }], [2, 2], [done("d", "fg", 10), done("e", "fg", 10), done("f", "fg", 10)], 1);
    expect(plan.weeks[0]!.items.map((i) => i.workItemId)).toEqual(["huge"]);
  });
});

describe("costSummary", () => {
  it("reads as a short tracker comment", () => {
    expect(costSummary(done("a", "bob", 2.345))).toBe("Budget: 0k tokens across 1 run · 2.35% of a subscription week.");
  });
});
