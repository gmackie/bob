import { describe, expect, it } from "vitest";

import type { Beat } from "../src/beat";
import { createBeatLog } from "../src/beat-log";
import { beatLine, effectFor } from "../src/effects";

const beat = (id: string, kind: Beat["kind"], data?: Beat["data"]): Beat => ({ id, source: "sdlc", epoch: "e1", seq: 1, at: 0, kind, subject: { itemId: "1", issue: "BOB-1" }, data });

describe("effectFor", () => {
  it("celebrates outcomes and marks problems", () => {
    expect(effectFor(beat("a", "milestone", { milestone: "production-verified" }))).toMatchObject({ kind: "burst", text: "SHIPPED", haptic: "success" });
    expect(effectFor(beat("b", "item.failed", { stage: "checks-failed" }))).toMatchObject({ text: "CI MISS", tone: "bad", haptic: "error" });
    expect(effectFor(beat("c", "item.needs_human"))).toMatchObject({ haptic: "warning" });
    expect(effectFor(beat("d", "item.advanced", { from: "running", to: "validating" }))).toBeNull();
    expect(effectFor(beat("e", "gap"))).toMatchObject({ kind: "static" });
  });

  it("writes ticker lines with state labels", () => {
    expect(beatLine(beat("a", "item.advanced", { from: "running", to: "validating" }))).toBe("BOB-1 · Running → Validating");
    expect(beatLine(beat("b", "milestone", { milestone: "merged" }))).toBe("BOB-1 · merged");
  });
});

describe("createBeatLog", () => {
  it("dedupes, keeps newest first and stays bounded", () => {
    const log = createBeatLog(3);
    let calls = 0;
    log.subscribe(() => calls++);
    expect(log.push([beat("1", "gap"), beat("2", "gap")]).map((b) => b.id)).toEqual(["1", "2"]);
    expect(log.push([beat("2", "gap")])).toEqual([]);
    log.push([beat("3", "gap"), beat("4", "gap"), beat("4", "gap")]);
    expect(log.recent().map((b) => b.id)).toEqual(["4", "3", "2"]);
    expect(log.push([beat("1", "gap")])).toEqual([]);
    expect(calls).toBe(2);
    expect(log.version()).toBe(2);
  });
});
