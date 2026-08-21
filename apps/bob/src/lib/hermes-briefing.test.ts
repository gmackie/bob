import { describe, expect, it, vi } from "vitest";

import {
  buildHermesEveningClose,
  buildHermesMorningBrief,
  deliverHermesDailyBrief,
} from "./hermes-briefing";

describe("Hermes daily briefing", () => {
  it("preserves source counts and freshness while surfacing missing coverage", () => {
    const brief = buildHermesMorningBrief(
      [
        {
          source: "ooda",
          observedAt: "2026-08-21T11:55:00Z",
          coverage: "complete",
          total: 2,
          items: [
            {
              label: "Decision waiting",
              canonicalRef: { kind: "attention", id: "attention-1" },
            },
          ],
        },
        {
          source: "bob",
          observedAt: "2026-08-21T11:58:00Z",
          coverage: "partial",
          total: 4,
          items: [],
        },
        {
          source: "skillfleet",
          observedAt: "2026-08-21T11:57:00Z",
          coverage: "complete",
          total: 0,
          items: [],
        },
      ],
      new Date("2026-08-21T12:00:00Z"),
    );

    expect(brief.kind).toBe("morning");
    expect(brief.sections).toHaveLength(4);
    expect(brief.sections.find((section) => section.source === "ooda")).toMatchObject({
      total: 2,
      shown: 1,
      coverage: "complete",
      observedAt: "2026-08-21T11:55:00Z",
    });
    expect(brief.sections.find((section) => section.source === "bob")).toMatchObject({
      total: 4,
      shown: 0,
      coverage: "partial",
    });
    expect(
      brief.sections.find((section) => section.source === "forgegraph"),
    ).toMatchObject({ total: 0, shown: 0, coverage: "unknown", observedAt: null });
    expect(brief.gaps).toEqual([
      "bob reported partial coverage",
      "forgegraph did not report",
    ]);
  });

  it("keeps close-out facts evidence-backed and tomorrow items proposal-only", () => {
    const close = buildHermesEveningClose(
      {
        completed: [
          {
            label: "Hermes contract tests passed",
            canonicalRef: { kind: "test-run", id: "run-42" },
          },
        ],
        blocked: [],
        waiting: [],
        captured: [
          {
            label: "Lab workflow thought",
            canonicalRef: { kind: "conversation-event", id: "event-42" },
          },
        ],
        tomorrow: [
          {
            label: "Qualify the morning delivery",
            canonicalRef: { kind: "proposal", id: "proposal-42" },
          },
        ],
      },
      new Date("2026-08-21T22:00:00Z"),
    );

    expect(close.kind).toBe("evening");
    expect(close.sections.tomorrow[0]).toMatchObject({ proposed: true });
    expect(close.sections.completed[0]).toMatchObject({ proposed: false });
    expect(() =>
      buildHermesEveningClose({
        completed: [],
        blocked: [],
        waiting: [],
        captured: [],
        tomorrow: [
          {
            label: "Deploy everything",
            canonicalRef: { kind: "task", id: "task-unsafe" },
          },
        ],
      }),
    ).toThrow(/proposal/i);
  });

  it("uses a deterministic ledger key so restart replay schedules one delivery", async () => {
    const brief = buildHermesMorningBrief([], new Date("2026-08-21T12:00:00Z"));
    let processed = false;
    const ledger = {
      claim: vi.fn(async () =>
        processed ? ("processed" as const) : ("new" as const),
      ),
      markProcessed: vi.fn(async () => {
        processed = true;
      }),
      markFailed: vi.fn(async () => undefined),
    };
    const schedule = vi.fn(async () => ({ jobId: "job-42" }));

    await expect(
      deliverHermesDailyBrief(brief, {
        ledger,
        schedule,
        scheduledFor: "2026-08-21T12:30:00Z",
      }),
    ).resolves.toEqual({ jobId: "job-42", deduplicated: false });
    await expect(
      deliverHermesDailyBrief(brief, {
        ledger,
        schedule,
        scheduledFor: "2026-08-21T12:30:00Z",
      }),
    ).resolves.toEqual({ deduplicated: true });

    expect(ledger.claim).toHaveBeenCalledWith("hermes:morning:2026-08-21", brief);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
