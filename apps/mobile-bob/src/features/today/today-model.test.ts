import { describe, expect, it } from "vitest";

import type { DailyPlanInput } from "./today-model";
import {
  buildTodayProgress,
  buildTodayView,
  formatPlanDate,
} from "./today-model";

const NOW = new Date("2026-10-01T15:00:00.000Z");

const plan: DailyPlanInput = {
  id: "plan-1",
  workspaceId: "ws-1",
  planDate: "2026-10-01",
  status: "draft",
  summary:
    "3 items planned against a cap of 20, 1 from BizPulse.\n\n**Bob**\n- BOB-1 Fix cooldown — Next in the queue.",
  items: [
    {
      workItemId: "b",
      title: "Retry failed payments",
      identifier: "ACME-3",
      projectId: "p2",
      projectName: "Acme",
      objective: "From this morning's BizPulse briefing.",
      source: "bizpulse",
      statusAtPlan: "todo",
      order: 1,
      currentStatus: "in_progress",
    },
    {
      workItemId: "a",
      title: "Fix cooldown",
      identifier: "BOB-1",
      projectId: "p1",
      projectName: "Bob",
      objective: "Next in the queue.",
      source: "queue",
      statusAtPlan: "todo",
      order: 0,
      currentStatus: "done",
    },
    {
      workItemId: "c",
      title: "Nodes cooldown column",
      identifier: "BOB-9",
      projectId: "p1",
      projectName: "Bob",
      objective: "Carried over from yesterday's plan; did not finish.",
      source: "carryover",
      statusAtPlan: "blocked",
      order: 2,
      currentStatus: null,
    },
  ],
  intake: [
    {
      provider: "bizpulse",
      pulled: 3,
      created: 1,
      reused: 1,
      skipped: 1,
      error: null,
    },
  ],
  review: null,
  reviewSummary: null,
  capacity: 20,
  createdAt: "2026-10-01T06:00:00.000Z",
  approvedAt: null,
  closedAt: null,
};

describe("buildTodayView", () => {
  it("orders the plan, reads each item's live status, and links to the right view", () => {
    const view = buildTodayView(plan, { now: NOW });
    expect(view.items.map((i) => i.workItemId)).toEqual(["a", "b", "c"]);
    expect(view.items.map((i) => [i.outcome, i.statusLabel])).toEqual([
      ["done", "Done"],
      ["running", "Running"],
      ["blocked", "Blocked"],
    ]);
    expect(view.items[0]?.href).toBe("/work-items/a?view=outcome");
    expect(view.items[1]?.href).toBe("/work-items/b?view=queue");
    expect(view.items[1]?.sourceLabel).toBe("BizPulse");
    expect(view.items[2]?.sourceLabel).toBe("Carried over");
  });

  it("asks for approval while the plan is a draft", () => {
    const view = buildTodayView(plan, { now: NOW });
    expect(view.dateLabel).toBe("Today");
    expect(view.statusLabel).toBe("Waiting for approval");
    expect(view.tone).toBe("attention");
    expect(view.headline).toBe(
      "3 items proposed. Approve to set today's order.",
    );
    expect(view.canApprove).toBe(true);
    expect(view.canRegenerate).toBe(true);
    expect(view.canClose).toBe(false);
    expect(view.intakeLabel).toBe("BizPulse: 1 new, 1 recurring, 1 already in");
    expect(view.review).toBeNull();
  });

  it("reports progress once approved, and flags a blocked day", () => {
    const view = buildTodayView(
      { ...plan, status: "approved", approvedAt: "2026-10-01T07:00:00.000Z" },
      { now: NOW },
    );
    expect(view.statusLabel).toBe("In progress");
    expect(view.headline).toBe("1 of 3 finished · 1 running · 1 blocked");
    expect(view.progress.fraction).toBeCloseTo(1 / 3);
    expect(view.tone).toBe("attention");
    expect(view.canApprove).toBe(false);
    expect(view.canClose).toBe(true);
  });

  it("shows the review grouped by outcome once closed", () => {
    const view = buildTodayView(
      {
        ...plan,
        status: "closed",
        closedAt: "2026-10-01T21:00:00.000Z",
        reviewSummary:
          "2 of 3 planned items finished (1 waiting on your review); 0 still running, 1 blocked, 0 failed, 0 not started.\n...",
        review: {
          items: [
            {
              workItemId: "a",
              title: "Fix cooldown",
              identifier: "BOB-1",
              outcome: "done",
              status: "done",
              sessionIds: ["s1"],
            },
            {
              workItemId: "b",
              title: "Retry failed payments",
              identifier: "ACME-3",
              outcome: "in_review",
              status: "in_review",
              sessionIds: ["s2", "s3"],
            },
            {
              workItemId: "c",
              title: "Nodes cooldown column",
              identifier: "BOB-9",
              outcome: "blocked",
              status: "blocked",
              sessionIds: [],
            },
          ],
          counts: { done: 1, in_review: 1, blocked: 1 },
          unplannedSessionIds: ["s9"],
          sessionsCompleted: 3,
          sessionsFailed: 0,
          sessionsBlocked: 1,
          generatedAt: "2026-10-01T21:00:00.000Z",
        },
      },
      { now: NOW },
    );
    expect(view.statusLabel).toBe("Reviewed");
    expect(view.headline).toMatch(/^2 of 3 planned items finished/);
    expect(view.review?.sections.map((s) => s.title)).toEqual([
      "Needs your review",
      "Done",
      "Blocked",
    ]);
    expect(view.review?.sections[0]?.rows[0]?.sessionIds).toEqual(["s2", "s3"]);
    expect(view.review?.sessionsLabel).toBe(
      "3 completed · 0 failed · 1 blocked",
    );
    expect(view.review?.unplannedSessionIds).toEqual(["s9"]);
  });

  it("surfaces an intake failure instead of hiding it", () => {
    const view = buildTodayView(
      {
        ...plan,
        intake: [
          {
            provider: "bizpulse",
            pulled: 0,
            created: 0,
            reused: 0,
            skipped: 0,
            error: "HTTP 401",
          },
        ],
      },
      { now: NOW },
    );
    expect(view.intakeError).toBe("bizpulse: HTTP 401");
    expect(view.intakeLabel).toBeNull();
  });
});

describe("formatPlanDate / buildTodayProgress", () => {
  it("names today and yesterday, and dates the rest", () => {
    expect(formatPlanDate("2026-10-01", NOW)).toBe("Today");
    expect(formatPlanDate("2026-09-30", NOW)).toBe("Yesterday");
    expect(formatPlanDate("2026-09-28", NOW)).toMatch(/Sep 28/);
  });

  it("counts an empty plan honestly", () => {
    expect(buildTodayProgress([]).label).toBe("Nothing planned");
  });
});
