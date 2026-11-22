import { describe, expect, it } from "vitest";
import type { CiMessage, CiPhase, TailFrame } from "@bob/sdlc-view";

import { activityAt, attemptBeats, ciBeats, ciMeter, ciProgress, classifyLine, newTailLines, tailBeats } from "../src/attempt-beats";
import { beatLine, effectFor } from "../src/effects";

const frame = (lines: string[], at: string, attemptId = "a1"): TailFrame => ({ itemId: "1", attemptId, threadId: "t1", lines, threadStatus: "running", at });
const ci = (phases: [string, CiPhase["status"]][], at: string, sha = "abc"): CiMessage => ({
  type: "ci",
  itemId: "1",
  available: true,
  sha,
  summary: "",
  phases: phases.map(([name, status]) => ({ name, status })),
  at,
});

describe("classifyLine", () => {
  it("names the commands an agent runs", () => {
    expect(classifyLine("$ pnpm test (exit 0)")).toEqual({ action: "test", exit: 0 });
    expect(classifyLine("$ pnpm exec vitest run")).toEqual({ action: "test", exit: null });
    expect(classifyLine("$ pnpm test:types (exit 2)")).toEqual({ action: "typecheck", exit: 2 });
    expect(classifyLine("$ pnpm install --frozen-lockfile (exit 0)")?.action).toBe("install");
    expect(classifyLine('$ git commit -m "fix lint and tests" (exit 0)')?.action).toBe("commit");
    expect(classifyLine("$ git push -u origin HEAD (exit 0)")?.action).toBe("push");
    expect(classifyLine("$ git status (exit 0)")?.action).toBe("git");
    expect(classifyLine("$ pnpm build (exit 1)")).toEqual({ action: "build", exit: 1 });
    expect(classifyLine("$ ls -la (exit 0)")?.action).toBe("command");
    expect(classifyLine("I will now run the tests.")).toBeNull();
  });
});

describe("newTailLines", () => {
  it("finds what the sliding window added", () => {
    expect(newTailLines(["a", "b", "c"], ["a", "b", "c", "d"])).toEqual(["d"]);
    expect(newTailLines(["a", "b", "c"], ["b", "c", "d", "e"])).toEqual(["d", "e"]);
    expect(newTailLines(["a", "b"], ["a", "b"])).toEqual([]);
    expect(newTailLines([], ["a"])).toEqual(["a"]);
  });

  it("counts a command that finished in place", () => {
    expect(newTailLines(["x", "$ pnpm test"], ["x", "$ pnpm test (exit 0)", "done"])).toEqual(["$ pnpm test (exit 0)", "done"]);
  });

  it("caps a frame with no overlap", () => {
    const next = Array.from({ length: 20 }, (_, i) => `n${i}`);
    expect(newTailLines(["old"], next, 3)).toEqual(["n17", "n18", "n19"]);
  });
});

describe("tailBeats", () => {
  const t0 = frame(["thinking", "$ pnpm test"], "2026-11-21T10:00:00Z");

  it("is a baseline on the first frame, a new attempt or an older frame", () => {
    expect(tailBeats(undefined, t0)).toEqual([]);
    expect(tailBeats(t0, frame(["$ pnpm test (exit 0)"], "2026-11-21T10:00:05Z", "a2"))).toEqual([]);
    expect(tailBeats(t0, frame(["more"], "2026-11-21T09:00:00Z"))).toEqual([]);
  });

  it("emits activity plus one beat per finished or named command", () => {
    const next = frame(["thinking", "$ pnpm test (exit 1)", "fixing", "$ ls (exit 0)", "$ git push (exit 0)"], "2026-11-21T10:00:05Z");
    const beats = tailBeats(t0, next, "BOB-1");
    expect(beats.map((b) => `${b.kind}:${b.data?.action ?? ""}:${b.data?.exit ?? ""}`)).toEqual([
      "agent.activity::",
      "agent.action:test:1",
      "agent.action:command:0",
      "agent.action:push:0",
    ]);
    expect(beats[0]!.subject).toEqual({ itemId: "1", issue: "BOB-1" });
    expect(new Set(beats.map((b) => b.id)).size).toBe(beats.length);
    expect(tailBeats(t0, next, "BOB-1")).toEqual(beats);
  });

  it("maps actions to effects: agent's red tests warn, pushes stamp, activity sparks", () => {
    const next = frame(["thinking", "$ pnpm test (exit 1)", "$ git push (exit 0)"], "2026-11-21T10:00:05Z");
    const fx = tailBeats(t0, next).map(effectFor);
    expect(fx[0]).toMatchObject({ kind: "spark", text: "", haptic: null });
    expect(fx[1]).toMatchObject({ text: "TESTS ✗", tone: "warn", haptic: null });
    expect(fx[2]).toMatchObject({ kind: "stamp", text: "PUSHED", haptic: "light" });
    expect(beatLine(tailBeats(t0, next, "BOB-1")[2]!)).toBe("BOB-1 · $ git push (exit 0)");
  });
});

describe("ciBeats", () => {
  const c0 = ci([["lint", "running"], ["test", "queued"]], "2026-11-21T10:00:00Z");

  it("is a baseline on the first message and a new sha", () => {
    expect(ciBeats(undefined, c0)).toEqual([]);
    expect(ciBeats(c0, ci([["lint", "passed"]], "2026-11-21T10:01:00Z", "def"))).toEqual([]);
  });

  it("emits phase changes and one green when the run settles", () => {
    const c1 = ci([["lint", "passed"], ["test", "running"]], "2026-11-21T10:01:00Z");
    const c2 = ci([["lint", "passed"], ["test", "passed"]], "2026-11-21T10:02:00Z");
    expect(ciBeats(c0, c1).map((b) => `${b.data?.phase}:${b.data?.to}`)).toEqual(["lint:passed", "test:running"]);
    const done = ciBeats(c1, c2);
    expect(done.map((b) => b.kind)).toEqual(["ci.phase", "ci.green"]);
    expect(effectFor(done[1]!)).toMatchObject({ kind: "burst", text: "GREEN", haptic: "success" });
    expect(ciBeats(c2, ci([["lint", "passed"], ["test", "passed"]], "2026-11-21T10:03:00Z"))).toEqual([]);
  });

  it("stamps a failed phase", () => {
    const fail = ciBeats(c0, ci([["lint", "failed"], ["test", "queued"]], "2026-11-21T10:01:00Z"));
    expect(effectFor(fail[0]!)).toMatchObject({ kind: "stamp", text: "✗ LINT", tone: "bad", haptic: "error" });
  });

  it("measures progress", () => {
    expect(ciProgress([])).toBe(0);
    expect(ciProgress(c0.available ? c0.phases : [])).toBe(0);
    expect(ciProgress([{ name: "a", status: "passed" }, { name: "b", status: "running" }])).toBe(0.5);
  });
});

describe("attemptBeats", () => {
  const t0 = frame(["a"], "2026-11-21T10:00:00Z");
  const t1 = frame(["a", "$ git push (exit 0)"], "2026-11-21T10:00:05Z");
  const c0 = ci([["test", "running"]], "2026-11-21T10:00:00Z");
  const c1 = ci([["test", "passed"]], "2026-11-21T10:00:06Z");

  it("diffs per-item detail records and skips new items", () => {
    const beats = attemptBeats({ "1": { tail: t0, ci: c0 } }, { "1": { tail: t1, ci: c1 }, "2": { tail: t1 } }, () => "BOB-1");
    expect(beats.map((b) => b.kind)).toEqual(["agent.activity", "agent.action", "ci.phase", "ci.green"]);
    expect(activityAt(beats, 42)).toEqual({ "1": 42 });
    const same = { "1": { tail: t1 } };
    expect(attemptBeats(same, same)).toEqual([]);
  });

  it("reads a CI meter", () => {
    expect(ciMeter(null)).toBeNull();
    expect(ciMeter(c0)).toEqual({ progress: 0, state: "running" });
    expect(ciMeter(c1)).toEqual({ progress: 1, state: "green" });
    expect(ciMeter(ci([["a", "passed"], ["b", "failed"]], "2026-11-21T10:00:00Z"))?.state).toBe("failed");
  });
});
