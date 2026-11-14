import { describe, expect, it } from "vitest";

import { NativeSessionTracker, nativeSessionIdFromLine } from "./native-session";

const CLAUDE_ID = "4743021e-110b-4f42-8f50-530699139927";

describe("nativeSessionIdFromLine", () => {
  it("reads Claude's init event and Codex's thread.started event", () => {
    expect(nativeSessionIdFromLine(JSON.stringify({ type: "system", subtype: "init", session_id: CLAUDE_ID, tools: [] }))).toBe(CLAUDE_ID);
    expect(nativeSessionIdFromLine(JSON.stringify({ type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" }))).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
  });

  it("ignores other events, prose and implausible ids", () => {
    expect(nativeSessionIdFromLine(JSON.stringify({ type: "assistant", session_id: CLAUDE_ID }))).toBeUndefined();
    expect(nativeSessionIdFromLine("the session id is 1234")).toBeUndefined();
    expect(nativeSessionIdFromLine(JSON.stringify({ type: "system", session_id: "x; rm -rf /" }))).toBeUndefined();
  });
});

describe("NativeSessionTracker", () => {
  it("finds an id split across chunks and reports it once per run", () => {
    const found: Array<[string, string]> = [];
    const tracker = new NativeSessionTracker((run, id) => found.push([run, id]));
    const line = `${JSON.stringify({ type: "system", subtype: "init", session_id: CLAUDE_ID })}\n`;
    tracker.feed("run-1", line.slice(0, 20));
    tracker.feed("run-1", line.slice(20));
    tracker.feed("run-1", line);
    tracker.feed("run-2", line);
    expect(found).toEqual([
      ["run-1", CLAUDE_ID],
      ["run-2", CLAUDE_ID],
    ]);
  });

  it("gives up after the scan limit without reporting", () => {
    const found: string[] = [];
    const tracker = new NativeSessionTracker((_run, id) => found.push(id));
    tracker.feed("run-1", `${"x".repeat(70 * 1024)}\n`);
    tracker.feed("run-1", `${JSON.stringify({ type: "system", session_id: CLAUDE_ID })}\n`);
    expect(found).toEqual([]);
  });
});
