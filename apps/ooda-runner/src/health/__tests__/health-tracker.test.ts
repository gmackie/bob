import { describe, expect, it } from "vitest";

import { HealthTracker } from "../health-tracker";

describe("HealthTracker", () => {
  it("records a successful invocation", () => {
    const tracker = new HealthTracker();
    tracker.recordInvocation("reddit", {
      status: 200,
      durationMs: 150,
      rateLimitRemaining: 58,
    });

    const health = tracker.getHealth("reddit");
    expect(health.status).toBe("up");
    expect(health.rateLimitRemaining).toBe(58);
    expect(health.lastSuccessAt).toBeDefined();
  });

  it("marks degraded after rate limit warning", () => {
    const tracker = new HealthTracker();
    tracker.recordInvocation("reddit", {
      status: 200,
      durationMs: 150,
      rateLimitRemaining: 2,
    });

    const health = tracker.getHealth("reddit");
    expect(health.status).toBe("degraded");
  });

  it("marks down after consecutive failures", () => {
    const tracker = new HealthTracker();

    for (let i = 0; i < 3; i++) {
      tracker.recordFailure("reddit", {
        status: 500,
        error: "Internal Server Error",
      });
    }

    const health = tracker.getHealth("reddit");
    expect(health.status).toBe("down");
    expect(health.errorCount).toBe(3);
  });

  it("recovers to up after successful invocation following failures", () => {
    const tracker = new HealthTracker();

    tracker.recordFailure("reddit", { status: 500, error: "Error" });
    tracker.recordFailure("reddit", { status: 500, error: "Error" });

    tracker.recordInvocation("reddit", {
      status: 200,
      durationMs: 100,
      rateLimitRemaining: 50,
    });

    const health = tracker.getHealth("reddit");
    expect(health.status).toBe("up");
    expect(health.errorCount).toBe(0);
  });

  it("lists health for all tracked connectors", () => {
    const tracker = new HealthTracker();

    tracker.recordInvocation("reddit", {
      status: 200,
      durationMs: 100,
      rateLimitRemaining: 50,
    });
    tracker.recordInvocation("hacker-news", {
      status: 200,
      durationMs: 80,
      rateLimitRemaining: 100,
    });

    const all = tracker.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((h) => h.connectorId)).toContain("reddit");
    expect(all.map((h) => h.connectorId)).toContain("hacker-news");
  });

  it("returns unknown status for untracked connector", () => {
    const tracker = new HealthTracker();
    const health = tracker.getHealth("unknown");
    expect(health.status).toBe("unknown");
  });
});
