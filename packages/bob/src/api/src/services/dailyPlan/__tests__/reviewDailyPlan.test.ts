import { describe, expect, it } from "vitest";

import type { DailyPlanItem } from "@bob/db/schema";

import { renderReviewSummary, reviewDailyPlan } from "../reviewDailyPlan";

const item = (id: string, order: number): DailyPlanItem => ({
  workItemId: id,
  title: `Task ${id}`,
  identifier: `BOB-${id}`,
  projectId: "p1",
  projectName: "Bob",
  objective: "Next in the queue.",
  source: "queue",
  statusAtPlan: "todo",
  order,
});

describe("reviewDailyPlan", () => {
  const NOW = new Date("2026-10-01T22:00:00.000Z");

  it("grades every planned item by where it ended up and attaches its sessions", () => {
    const review = reviewDailyPlan({
      now: NOW,
      items: [item("a", 1), item("b", 0), item("c", 2), item("d", 3)],
      workItems: [
        { workItemId: "a", status: "done" },
        { workItemId: "b", status: "in_review" },
        { workItemId: "c", status: "blocked" },
        // "d" has no current row: fall back to its status at plan time.
      ],
      sessions: [
        { sessionId: "s1", workItemId: "b", status: "completed" },
        { sessionId: "s2", workItemId: "c", status: "blocked" },
        { sessionId: "s3", workItemId: "zzz", status: "failed" },
        { sessionId: "s4", workItemId: null, status: "completed" },
      ],
    });
    expect(review.items.map((i) => [i.workItemId, i.outcome])).toEqual([
      ["b", "in_review"],
      ["a", "done"],
      ["c", "blocked"],
      ["d", "not_started"],
    ]);
    expect(review.items[0]?.sessionIds).toEqual(["s1"]);
    expect(review.counts).toMatchObject({
      done: 1,
      in_review: 1,
      blocked: 1,
      not_started: 1,
    });
    expect(review.unplannedSessionIds).toEqual(["s3", "s4"]);
    expect(review.sessionsCompleted).toBe(2);
    expect(review.sessionsFailed).toBe(1);
    expect(review.sessionsBlocked).toBe(1);
    expect(review.generatedAt).toBe(NOW.toISOString());
  });

  it("renders the verdict first, then the names under what needs you", () => {
    const review = reviewDailyPlan({
      now: NOW,
      items: [item("a", 0), item("b", 1), item("c", 2)],
      workItems: [
        { workItemId: "a", status: "done" },
        { workItemId: "b", status: "in_review" },
        { workItemId: "c", status: "todo" },
      ],
      sessions: [{ sessionId: "s9", workItemId: null, status: "completed" }],
    });
    const text = renderReviewSummary("2026-10-01", review);
    expect(text.split("\n")[0]).toBe(
      "2 of 3 planned items finished (1 waiting on your review); 0 still running, 0 blocked, 0 failed, 1 not started.",
    );
    expect(text).toContain(
      "1 session completed, 0 failed, 0 blocked; 1 ran outside the plan.",
    );
    expect(text.indexOf("**Needs your review**")).toBeLessThan(
      text.indexOf("**Done**"),
    );
    expect(text).toContain("- BOB-b Task b");
  });

  it("is honest when there was no plan", () => {
    const review = reviewDailyPlan({
      now: NOW,
      items: [],
      workItems: [],
      sessions: [],
    });
    expect(renderReviewSummary("2026-10-01", review)).toBe(
      "No plan was set for 2026-10-01.\n0 sessions completed, 0 failed, 0 blocked.",
    );
  });
});
