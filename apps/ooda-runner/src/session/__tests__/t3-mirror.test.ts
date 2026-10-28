import { describe, expect, it } from "vitest";

import { mirrorT3ThreadToSession, type T3MirrorSnapshotThread } from "../t3-mirror";

function snapshotFetch(frames: T3MirrorSnapshotThread[]) {
  let i = 0;
  const fetchImpl = (async () => {
    const thread = frames[Math.min(i, frames.length - 1)];
    i += 1;
    return new Response(JSON.stringify({ threads: [thread] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => i };
}

const threadId = "ooda-session-s1";
const msg = (id: string, text: string) => ({ id, role: "assistant", text });
const user = { id: "m0", role: "user", text: "prompt" };

describe("mirrorT3ThreadToSession", () => {
  it("does not complete while the provider turn is still active, even if latestTurn says completed", async () => {
    // t3code flips latestTurn.state to "completed" after the first assistant
    // message while tools keep running; only provider idleness ends the session.
    const running = {
      id: threadId,
      latestTurn: { state: "completed" },
      session: { status: "running", activeTurnId: "t1", lastError: null },
      messages: [user, msg("a1", "working...")],
    };
    const done = {
      ...running,
      session: { status: "ready", activeTurnId: null, lastError: null },
      messages: [user, msg("a1", "working..."), msg("a2", "final answer")],
    };
    const { fetchImpl, calls } = snapshotFetch([running, running, running, done]);
    const seen: string[] = [];
    const result = await mirrorT3ThreadToSession({
      serverUrl: "http://t3.test",
      threadId,
      fetchImpl,
      sleep: async () => {},
      pollIntervalMs: 0,
      onAssistantMessage: (text) => {
        seen.push(text);
      },
    });
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("final answer");
    expect(seen).toEqual(["working...", "final answer"]);
    expect(calls()).toBe(4);
  });

  it("fails when the provider session reports an error", async () => {
    const errored = {
      id: threadId,
      session: { status: "ready", activeTurnId: null, lastError: { message: "provider exploded" } },
      messages: [user],
    };
    const { fetchImpl } = snapshotFetch([errored]);
    const result = await mirrorT3ThreadToSession({
      serverUrl: "http://t3.test",
      threadId,
      fetchImpl,
      sleep: async () => {},
      onAssistantMessage: () => {},
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("provider exploded");
  });

  it("times out when the turn never finishes", async () => {
    let t = 0;
    const stuck = {
      id: threadId,
      session: { status: "running", activeTurnId: "t1", lastError: null },
      messages: [user, msg("a1", "still going")],
    };
    const { fetchImpl } = snapshotFetch([stuck]);
    const result = await mirrorT3ThreadToSession({
      serverUrl: "http://t3.test",
      threadId,
      fetchImpl,
      sleep: async () => {
        t += 1_000;
      },
      now: () => t,
      timeoutMs: 5_000,
      onAssistantMessage: () => {},
    });
    expect(result.status).toBe("timed_out");
    expect(result.finalText).toBe("still going");
  });
});
