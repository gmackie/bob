/**
 * Live check progress, as a phone shows it.
 *
 * This is the "watch the lights turn green" surface. The runner already emits
 * structured `check` events per phase — lint, typecheck, test — carrying a
 * status and pass/fail counts. Nothing on mobile read them, so a person on the
 * road could see that a run was going but not what it was doing.
 *
 * The model folds a stream of events into one row per phase, because a phase
 * reports repeatedly as it progresses and a person wants the current state,
 * not a log.
 */
import { describe, expect, it } from "vitest";

import { foldCheckEvents } from "./live-checks-model";

const ev = (payload: Record<string, unknown>, seq: number) => ({
  eventType: "check" as const,
  seq,
  payload,
});

describe("foldCheckEvents", () => {
  it("shows one row per phase, in the order phases first reported", () => {
    // Runners emit in dependency order; re-sorting alphabetically would make
    // the list jump around as later phases arrive.
    const rows = foldCheckEvents([
      ev({ phase: "lint", status: "passed" }, 1),
      ev({ phase: "typecheck", status: "running" }, 2),
      ev({ phase: "test", status: "running" }, 3),
    ]);

    expect(rows.map((r) => r.phase)).toEqual(["lint", "typecheck", "test"]);
  });

  it("keeps the latest state for a phase rather than appending", () => {
    // A phase reports repeatedly; the row should settle, not accumulate.
    const rows = foldCheckEvents([
      ev({ phase: "test", status: "running" }, 1),
      ev({ phase: "test", status: "passed", counts: { passed: 12, failed: 0, total: 12 } }, 2),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("passed");
    expect(rows[0]?.countsLabel).toBe("12 passed");
  });

  it("shows failures with their count, which is the number that matters", () => {
    const rows = foldCheckEvents([
      ev({ phase: "test", status: "failed", counts: { passed: 3, failed: 1, total: 4 } }, 1),
    ]);

    expect(rows[0]?.tone).toBe("red");
    expect(rows[0]?.countsLabel).toBe("1 failed, 3 passed");
  });

  it("gives each status a tone a person can read at a glance", () => {
    const rows = foldCheckEvents([
      ev({ phase: "lint", status: "passed" }, 1),
      ev({ phase: "typecheck", status: "failed" }, 2),
      ev({ phase: "test", status: "running" }, 3),
      ev({ phase: "build", status: "skipped" }, 4),
    ]);

    const tones = Object.fromEntries(rows.map((r) => [r.phase, r.tone]));
    expect(tones.lint).toBe("green");
    expect(tones.typecheck).toBe("red");
    expect(tones.test).toBe("amber");
    expect(tones.build).toBe("grey");
  });

  it("ignores the run_finished rollup, which would duplicate every phase", () => {
    // The runner emits a summary with phase "all"; rendering it as a row
    // repeats what the individual phases already say.
    const rows = foldCheckEvents([
      ev({ phase: "test", status: "passed" }, 1),
      ev({ v: 2, phase: "all", event: "run_finished", status: "passed" }, 2),
    ]);

    expect(rows.map((r) => r.phase)).toEqual(["test"]);
  });

  it("ignores events that are not checks", () => {
    const rows = foldCheckEvents([
      { eventType: "output_chunk", seq: 1, payload: { data: "hello" } },
      ev({ phase: "test", status: "passed" }, 2),
    ]);

    expect(rows).toHaveLength(1);
  });

  it("skips a check with no phase rather than rendering a blank row", () => {
    expect(foldCheckEvents([ev({ status: "passed" }, 1)])).toEqual([]);
  });

  it("returns nothing before any check arrives", () => {
    expect(foldCheckEvents([])).toEqual([]);
  });

  it("treats an unknown status as in-progress rather than hiding the phase", () => {
    // A new status from a future runner should still show the phase running,
    // not vanish from the list.
    const rows = foldCheckEvents([ev({ phase: "test", status: "some_new_state" }, 1)]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tone).toBe("grey");
  });
});
