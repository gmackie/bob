import { describe, expect, it } from "vitest";
import type { CiMessage } from "@bob/sdlc-view";

import { beatTone, deskMood, liveCiPhases, tailLineTone } from "../src/activity";
import type { Beat } from "../src/beat";

describe("tailLineTone", () => {
  it("classifies shell commands by exit code, questions, and prose", () => {
    expect(tailLineTone("$ pnpm vitest run")).toBe("command-run");
    expect(tailLineTone("$ pnpm vitest run (exit 0)")).toBe("command-ok");
    expect(tailLineTone("$ pnpm vitest run (exit 1)")).toBe("command-fail");
    expect(tailLineTone("asking: Ship behind a flag?")).toBe("question");
    expect(tailLineTone("editing packages/bob/src/arcade/src/floor.ts")).toBe("prose");
  });
});

describe("deskMood", () => {
  const base = { state: "running" as const, attention: "ok" as const, lines: [], quiet: false, ci: null };

  it("prioritizes human attention and stalls", () => {
    expect(deskMood({ ...base, attention: "needs_human" })).toBe("asking");
    expect(deskMood({ ...base, state: "waiting-input" })).toBe("asking");
    expect(deskMood({ ...base, attention: "stalled" })).toBe("stalled");
  });

  it("reflects live shell commands in the newest tail line", () => {
    expect(deskMood({ ...base, lines: ["$ pnpm vitest run"] })).toBe("testing");
    expect(deskMood({ ...base, lines: ["$ pnpm typecheck (exit 0)"] })).toBe("building");
    expect(deskMood({ ...base, lines: ["$ git push (exit 0)"] })).toBe("shipping");
    expect(deskMood({ ...base, lines: ["editing apps/bob/src/components/cockpit/floor-panel.tsx"] })).toBe("coding");
    expect(deskMood({ ...base, lines: ["$ pnpm vitest run"], quiet: true })).toBe("idle");
  });

  it("reflects live CI phases", () => {
    expect(
      deskMood({
        ...base,
        state: "validating",
        ci: { summary: "1/2", phases: [{ name: "lint", status: "passed" }, { name: "test", status: "running" }] },
      }),
    ).toBe("ci-running");
    expect(
      deskMood({
        ...base,
        state: "validating",
        ci: { summary: "1/2", phases: [{ name: "lint", status: "passed" }, { name: "test", status: "failed" }] },
      }),
    ).toBe("ci-failed");
    expect(
      deskMood({
        ...base,
        state: "review",
        ci: { summary: "2/2", phases: [{ name: "lint", status: "passed" }, { name: "test", status: "passed" }] },
      }),
    ).toBe("ci-green");
    expect(
      deskMood({
        ...base,
        state: "deploying",
        ci: { summary: "2/2", phases: [{ name: "lint", status: "passed" }, { name: "test", status: "passed" }] },
      }),
    ).toBe("shipping");
  });
});

describe("beatTone & liveCiPhases", () => {
  it("maps beats to visual tones", () => {
    const mk = (kind: Beat["kind"], data?: Beat["data"]): Beat => ({
      id: kind,
      source: "sdlc",
      epoch: "e",
      seq: 1,
      at: 1,
      kind,
      subject: {},
      data,
    });
    expect(beatTone(mk("ci.green", { phases: 4 }))).toBe("good");
    expect(beatTone(mk("item.failed"))).toBe("bad");
    expect(beatTone(mk("item.needs_human"))).toBe("warn");
    expect(beatTone(mk("item.advanced"))).toBe("info");
  });

  it("extracts bounded phases only from available CI messages", () => {
    const unavail: CiMessage = { type: "ci", itemId: "1", available: false, reason: "none", at: "2026-11-22T00:00:00Z" };
    expect(liveCiPhases(unavail)).toEqual([]);
    const avail: CiMessage = {
      type: "ci",
      itemId: "1",
      available: true,
      sha: "abc",
      summary: "2/2",
      phases: [{ name: "lint", status: "passed" }, { name: "test", status: "running" }],
      at: "2026-11-22T00:00:00Z",
    };
    expect(liveCiPhases(avail, 1)).toHaveLength(1);
    expect(liveCiPhases(avail)).toHaveLength(2);
  });
});
