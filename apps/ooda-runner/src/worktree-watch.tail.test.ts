import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { watchWorktree, CHECK_EVENT_FILES } from "./worktree-watch";

import type { CheckEvent } from "@forgegraph/check-events";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpWorktree(): string {
  const d = mkdtempSync(join(tmpdir(), "bob-watch-"));
  dirs.push(d);
  return d;
}

describe("check-events tail", () => {
  it("emits v1 (upgraded) and v2 lines from both events files, carrying partial lines", () => {
    const wt = tmpWorktree();
    const events: CheckEvent[] = [];
    const handle = watchWorktree({
      path: wt,
      branch: "b",
      baseBranch: "main",
      intervalMs: 60_000,
      emit: () => {},
      emitCheck: (e) => events.push(e),
    });
    try {
      // legacy bob-check v1 line in .bob/
      mkdirSync(join(wt, ".bob"), { recursive: true });
      writeFileSync(join(wt, CHECK_EVENT_FILES[0]), JSON.stringify({ phase: "lint", status: "passed", exitCode: 0, durationMs: 12 }) + "\n");
      // v2 line in .fg/, then a partial second line
      mkdirSync(join(wt, ".fg"), { recursive: true });
      const v2 = { v: 2, phase: "test", event: "run_finished", at: "2026-08-24T00:00:00.000Z", status: "failed", counts: { passed: 3, failed: 1, total: 4 } };
      writeFileSync(join(wt, CHECK_EVENT_FILES[1]), JSON.stringify(v2) + '\n{"v":2,"phase":"build","ev');
      handle.drainChecks();
      expect(events.map((e) => `${e.phase}:${e.event}:${e.status}`)).toEqual(["lint:run_finished:passed", "test:run_finished:failed"]);
      expect(events[0]!.v).toBe(2);
      // complete the partial line
      appendFileSync(join(wt, CHECK_EVENT_FILES[1]), 'ent":"run_started","at":"2026-08-24T00:00:01.000Z"}\n');
      handle.drainChecks();
      expect(events.map((e) => e.phase)).toEqual(["lint", "test", "build"]);
      expect(events[2]!.event).toBe("run_started");
    } finally {
      handle.stop();
    }
  });

  it("stop() drains events written after the last tick", () => {
    const wt = tmpWorktree();
    const events: CheckEvent[] = [];
    const handle = watchWorktree({ path: wt, branch: "b", baseBranch: "main", intervalMs: 60_000, emit: () => {}, emitCheck: (e) => events.push(e) });
    mkdirSync(join(wt, ".bob"), { recursive: true });
    writeFileSync(join(wt, CHECK_EVENT_FILES[0]), JSON.stringify({ v: 2, phase: "typecheck", event: "skipped", at: "2026-08-24T00:00:00.000Z", reason: "no target" }) + "\n");
    handle.stop();
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("skipped");
  });
});
