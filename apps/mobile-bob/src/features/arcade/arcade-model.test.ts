import { describe, expect, it } from "vitest";
import { createBeatLog } from "@bob/arcade";
import { reduce } from "@bob/sdlc-view";
import type { EdgeMessage } from "@bob/sdlc-view";

import { item, plan, viewOf } from "~/features/sdlc/test-fixtures";

import { EFFECT_TTL_MS, MAX_EFFECTS, expire, step, stepAttempts } from "./arcade-model";

const base = viewOf([{ planId: "p1", items: [{ itemId: "a", state: "running" }, { itemId: "b", state: "validating" }] }]);
const delta = (seq: number, specs: Parameters<typeof item>[1][]): EdgeMessage => ({
  type: "delta",
  seq,
  plans: [],
  items: specs.map((s) => ({ ...item("p1", s), resourceVersion: seq })),
  coordinatorSeenAt: 2,
});

describe("arcade step", () => {
  it("turns a view change into beats, effects and one haptic", () => {
    const log = createBeatLog();
    const next = reduce(base, delta(2, [{ itemId: "a", state: "waiting-input" }, { itemId: "b", state: "failed" }]));
    const out = step(log, base, next, [], 100);
    expect(out.beats.map((b) => b.kind)).toEqual(["item.needs_human", "item.failed"]);
    expect(out.effects.map((e) => e.text)).toEqual(["NEEDS YOU", "FAILED"]);
    expect(out.haptic).toBe("error");
  });

  it("only alerts for visible work and keeps the global history available when a project closes", () => {
    const log = createBeatLog();
    const next = reduce(base, delta(2, [{ itemId: "a", state: "waiting-input" }, { itemId: "b", state: "failed" }]));
    expect(step(log, base, next, [], 100, new Set(["a"])).haptic).toBe("warning");
    expect(log.recent().map(b => b.kind)).toEqual(["item.failed", "item.needs_human"]);
  });

  it("does not replay beats or celebrate the first snapshot", () => {
    const log = createBeatLog();
    const next = reduce(base, delta(2, [{ itemId: "a", state: "validating" }]));
    expect(step(log, base, next, [], 0).beats).toHaveLength(1);
    expect(step(log, base, next, [], 1).beats).toHaveLength(0);
    expect(step(createBeatLog(), viewOf([]), base, [], 0).beats).toHaveLength(0);
  });

  it("expires and caps effects", () => {
    const log = createBeatLog();
    const many = reduce(base, {
      type: "delta",
      seq: 2,
      plans: [plan("p1", Array.from({ length: MAX_EFFECTS + 8 }, (_, i) => ({ itemId: `n${i}`, state: "ready" as const })))],
      items: Array.from({ length: MAX_EFFECTS + 8 }, (_, i) => item("p1", { itemId: `n${i}`, state: "ready" })),
      coordinatorSeenAt: 2,
    });
    const out = step(log, base, many, [], 0);
    expect(out.effects).toHaveLength(MAX_EFFECTS);
    expect(expire(out.effects, EFFECT_TTL_MS + 1)).toHaveLength(0);
  });
});

describe("arcade stepAttempts", () => {
  const frame = (lines: string[], at: string) => ({ itemId: "a", attemptId: "x", threadId: "t", lines, threadStatus: "running", at });
  it("turns new tail lines into sparks, labels, activity and a light haptic for a push", () => {
    const log = createBeatLog();
    const prev = { a: { tail: frame(["thinking"], "2026-11-21T10:00:00Z") } };
    const next = { a: { tail: frame(["thinking", "$ git push (exit 0)"], "2026-11-21T10:00:04Z") } };
    const out = stepAttempts(log, prev, next, () => "BOB-1", [], 500);
    expect(out.effects.map((e) => e.kind)).toEqual(["spark", "stamp"]);
    expect(out.haptic).toBe("light");
    expect(out.activity).toEqual({ a: 500 });
    expect(stepAttempts(log, prev, next, () => "BOB-1", out.effects, 600).beats).toEqual([]);
  });
});
