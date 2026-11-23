import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "../buildDailyPlan";
import { buildDailyPlan } from "../buildDailyPlan";

const c = (
  over: Partial<PlanCandidate> & { workItemId: string },
): PlanCandidate => ({
  title: `Task ${over.workItemId}`,
  identifier: `BOB-${over.workItemId}`,
  projectId: "p1",
  projectName: "Bob",
  status: "todo",
  queueSortOrder: 40,
  createdAt: "2026-09-30T08:00:00.000Z",
  ...over,
});

describe("buildDailyPlan", () => {
  it("fills the cap from the queue in queue order, then age", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 2,
      inFlight: [],
      candidates: [
        c({
          workItemId: "late",
          queueSortOrder: 40,
          createdAt: "2026-09-30T10:00:00.000Z",
        }),
        c({ workItemId: "urgent", queueSortOrder: 10 }),
        c({
          workItemId: "early",
          queueSortOrder: 40,
          createdAt: "2026-09-30T06:00:00.000Z",
        }),
      ],
    });
    expect(plan.items.map((i) => i.workItemId)).toEqual(["urgent", "early"]);
    expect(plan.deferred.map((i) => i.workItemId)).toEqual(["late"]);
    expect(plan.items[0]?.order).toBe(0);
  });

  it("puts running work, then carry-overs, then intake ahead of the plain queue", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 10,
      inFlight: [c({ workItemId: "running", status: "in_progress" })],
      candidates: [
        c({ workItemId: "queue", queueSortOrder: 10 }),
        c({
          workItemId: "intake",
          intakeProvider: "bizpulse",
          queueSortOrder: 50,
        }),
        c({ workItemId: "carry", carriedOver: true, queueSortOrder: 50 }),
      ],
    });
    expect(plan.items.map((i) => i.workItemId)).toEqual([
      "running",
      "carry",
      "intake",
      "queue",
    ]);
    expect(plan.items.map((i) => i.source)).toEqual([
      "queue",
      "carryover",
      "bizpulse",
      "queue",
    ]);
    expect(plan.items[1]?.objective).toMatch(/Carried over/);
    expect(plan.items[2]?.objective).toMatch(/BizPulse/);
  });

  it("plans blocked items last, since they wait on a person rather than capacity", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 1,
      inFlight: [],
      candidates: [
        c({ workItemId: "blocked", status: "blocked", queueSortOrder: 10 }),
        c({ workItemId: "todo", status: "todo", queueSortOrder: 40 }),
      ],
    });
    expect(plan.items.map((i) => i.workItemId)).toEqual(["todo"]);
  });

  it("ignores items that cannot be worked and never lists one twice", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 5,
      inFlight: [c({ workItemId: "dup", status: "in_progress" })],
      candidates: [
        c({ workItemId: "dup", status: "in_progress" }),
        c({ workItemId: "done", status: "done" }),
        c({ workItemId: "draft", status: "draft" }),
      ],
    });
    expect(plan.items.map((i) => i.workItemId)).toEqual(["dup"]);
  });

  it("writes a summary a person can read: the shape of the day, grouped by project", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 2,
      inFlight: [],
      candidates: [
        c({ workItemId: "a", title: "Fix proxy cooldown", projectName: "Bob" }),
        c({
          workItemId: "b",
          title: "Retry failed payments",
          projectName: "Acme",
          intakeProvider: "bizpulse",
        }),
        c({ workItemId: "d", title: "Later", projectName: "Bob" }),
      ],
    });
    expect(plan.summary).toContain(
      "2 items planned against a cap of 2, 1 from BizPulse.",
    );
    expect(plan.summary).toContain("**Acme**");
    expect(plan.summary).toContain(
      "- BOB-b Retry failed payments — From this morning's BizPulse briefing.",
    );
    expect(plan.summary).toContain("Not today (1): BOB-d Later.");
  });

  it("says so when there is nothing to plan", () => {
    const plan = buildDailyPlan({
      planDate: "2026-10-01",
      capacity: 5,
      inFlight: [],
      candidates: [],
    });
    expect(plan.items).toEqual([]);
    expect(plan.summary).toBe(
      "Nothing planned for 2026-10-01: the queue is empty.",
    );
  });
});
