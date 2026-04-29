import { describe, expect, it } from "vitest";

import { SessionEventSchema, RunnerCommandSchema } from "../events";

describe("SessionEventSchema", () => {
  it("validates a stdout_chunk event", () => {
    const result = SessionEventSchema.parse({
      type: "stdout_chunk",
      sessionId: "session_1",
      threadId: "thread_sleep",
      timestamp: new Date().toISOString(),
      data: { content: "Searching Reddit for sleep tips..." },
    });
    expect(result.type).toBe("stdout_chunk");
  });

  it("validates a session_ended event with exit code", () => {
    const result = SessionEventSchema.parse({
      type: "session_ended",
      sessionId: "session_1",
      threadId: "thread_sleep",
      timestamp: new Date().toISOString(),
      data: { exitCode: 0, durationMs: 45000 },
    });
    expect(result.type).toBe("session_ended");
    if (result.type === "session_ended") {
      expect(result.data.exitCode).toBe(0);
    }
  });

  it("validates a promotion_available event", () => {
    const result = SessionEventSchema.parse({
      type: "promotion_available",
      sessionId: "session_1",
      threadId: "thread_sleep",
      timestamp: new Date().toISOString(),
      data: {
        noteTitle: "Sleep finding",
        artifactId: "sha256:abc123",
        kind: "observation",
      },
    });
    expect(result.type).toBe("promotion_available");
  });

  it("validates a session_failed event", () => {
    const result = SessionEventSchema.parse({
      type: "session_failed",
      sessionId: "session_1",
      threadId: "thread_sleep",
      timestamp: new Date().toISOString(),
      data: { error: "Process crashed", exitCode: 1 },
    });
    expect(result.type).toBe("session_failed");
  });
});

describe("RunnerCommandSchema", () => {
  it("validates a start_session command", () => {
    const result = RunnerCommandSchema.parse({
      type: "start_session",
      sessionId: "session_1",
      threadId: "thread_sleep",
      adapterId: "codex",
      toolProfileId: "research-light",
      prompt: "Research sleep optimization techniques",
      workspaceRoot: "/home/user/.ooda/threads/improve-sleep",
    });
    expect(result.type).toBe("start_session");
  });

  it("validates a cancel_session command", () => {
    const result = RunnerCommandSchema.parse({
      type: "cancel_session",
      sessionId: "session_1",
    });
    expect(result.type).toBe("cancel_session");
  });
});
