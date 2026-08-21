import { describe, expect, it } from "vitest";

import {
  bobStatusAfter,
  commentFor,
  pickTrackerState,
} from "../trackerMirror";
import type { MirrorEvent } from "../trackerMirror";

const STATES = [
  { id: "s-backlog", name: "Backlog", type: "backlog" },
  { id: "s-todo", name: "Todo", type: "unstarted" },
  { id: "s-prog", name: "In Progress", type: "started" },
  { id: "s-review", name: "In Review", type: "started" },
  { id: "s-done", name: "Done", type: "completed" },
  { id: "s-cancel", name: "Canceled", type: "canceled" },
];

describe("pickTrackerState", () => {
  it("claimed → the started-type state named In Progress", () => {
    expect(pickTrackerState(STATES, { kind: "claimed", agentType: "codex" })).toBe("s-prog");
  });
  it("pr_opened → a started-type state whose name mentions review, else null (do not move)", () => {
    expect(pickTrackerState(STATES, { kind: "pr_opened", prUrl: "u" })).toBe("s-review");
    const noReview = STATES.filter((s) => s.id !== "s-review");
    expect(pickTrackerState(noReview, { kind: "pr_opened", prUrl: "u" })).toBeNull();
  });
  it("merged → completed-type state", () => {
    expect(pickTrackerState(STATES, { kind: "merged", prUrl: "u" })).toBe("s-done");
  });
  it("pr_closed → backlog (human gate) ; requeued → unstarted", () => {
    expect(pickTrackerState(STATES, { kind: "pr_closed", prUrl: "u" })).toBe("s-backlog");
    expect(pickTrackerState(STATES, { kind: "requeued", reason: "r", attempt: 2 })).toBe("s-todo");
  });
  it("blocked / deployed / deploy_failed → stays where it is (comment only)", () => {
    expect(pickTrackerState(STATES, { kind: "blocked", reason: "x" })).toBeNull();
    expect(pickTrackerState(STATES, { kind: "deployed", summary: "s" })).toBeNull();
    expect(pickTrackerState(STATES, { kind: "deploy_failed", summary: "s" })).toBeNull();
    expect(bobStatusAfter("done", { kind: "deployed", summary: "s" })).toBeNull();
    expect(bobStatusAfter("done", { kind: "deploy_failed", summary: "s" })).toBeNull();
  });
  it("falls back to the first state of the right type when names differ", () => {
    const odd = [
      { id: "a", name: "Doing", type: "started" },
      { id: "b", name: "Shipped", type: "completed" },
    ];
    expect(pickTrackerState(odd, { kind: "claimed", agentType: "claude" })).toBe("a");
    expect(pickTrackerState(odd, { kind: "merged", prUrl: "u" })).toBe("b");
  });
});

describe("bobStatusAfter", () => {
  it("merged → done from any in-flight status", () => {
    expect(bobStatusAfter("in_review", { kind: "merged", prUrl: "u" })).toBe("done");
    expect(bobStatusAfter("in_progress", { kind: "merged", prUrl: "u" })).toBe("done");
  });
  it("pr_closed → backlog only from in-flight (never reopen a done item)", () => {
    expect(bobStatusAfter("in_review", { kind: "pr_closed", prUrl: "u" })).toBe("backlog");
    expect(bobStatusAfter("done", { kind: "pr_closed", prUrl: "u" })).toBeNull();
  });
  it("requeued → todo ; blocked → blocked ; claimed/pr_opened handled elsewhere", () => {
    expect(bobStatusAfter("in_progress", { kind: "requeued", reason: "r", attempt: 1 })).toBe("todo");
    expect(bobStatusAfter("in_progress", { kind: "blocked", reason: "r" })).toBe("blocked");
    expect(bobStatusAfter("todo", { kind: "claimed", agentType: "codex" })).toBeNull();
    expect(bobStatusAfter("in_progress", { kind: "pr_opened", prUrl: "u" })).toBeNull();
  });
});

describe("commentFor", () => {
  const cases: MirrorEvent[] = [
    { kind: "claimed", agentType: "codex" },
    { kind: "pr_opened", prUrl: "https://git/pr/1" },
    { kind: "merged", prUrl: "https://git/pr/1" },
    { kind: "pr_closed", prUrl: "https://git/pr/1" },
    { kind: "requeued", reason: "runner died", attempt: 2 },
    { kind: "blocked", reason: "3 failed attempts" },
    { kind: "deployed", summary: "production (ForgeGraph) · Deploy habit-app (Actions)" },
    { kind: "deploy_failed", summary: "staging: health check" },
  ];
  it("always produces a non-empty, single-purpose comment that links the PR when there is one", () => {
    for (const ev of cases) {
      const c = commentFor(ev);
      expect(c.length).toBeGreaterThan(10);
      if ("prUrl" in ev) expect(c).toContain(ev.prUrl);
    }
  });
});
