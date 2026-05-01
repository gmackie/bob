import { describe, expect, it } from "vitest";

import { ComparisonSession } from "../comparison-session";

describe("ComparisonSession", () => {
  it("creates two child sessions with a shared comparisonId", () => {
    const comparison = ComparisonSession.create({
      threadId: "thread_sleep",
      adapterIds: ["codex", "claude"],
      toolProfileId: "research-light",
      sourceBundleIds: ["general-research"],
      workspaceRoot: "/tmp/threads/thread_sleep",
      prompt: "Research sleep optimization",
    });

    expect(comparison.comparisonId).toBeDefined();
    expect(comparison.sessions).toHaveLength(2);
    expect(comparison.sessions[0]!.adapterId).toBe("codex");
    expect(comparison.sessions[1]!.adapterId).toBe("claude");
    expect(comparison.sessions[0]!.comparisonId).toBe(
      comparison.comparisonId,
    );
    expect(comparison.sessions[1]!.comparisonId).toBe(
      comparison.comparisonId,
    );
  });

  it("rejects comparison with fewer than 2 adapters", () => {
    expect(() =>
      ComparisonSession.create({
        threadId: "thread_1",
        adapterIds: ["codex"],
        toolProfileId: "research-light",
        sourceBundleIds: [],
        workspaceRoot: "/tmp/t1",
        prompt: "test",
      }),
    ).toThrow("at least 2 adapters");
  });

  it("tracks partial results when one session fails", () => {
    const comparison = ComparisonSession.create({
      threadId: "thread_1",
      adapterIds: ["codex", "claude"],
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
      prompt: "test",
    });

    comparison.markSessionCompleted(comparison.sessions[0]!.id, {
      exitCode: 0,
      output: "Codex results",
    });

    comparison.markSessionFailed(comparison.sessions[1]!.id, {
      error: "Claude API timeout",
    });

    expect(comparison.status).toBe("partial");
    expect(comparison.results.get(comparison.sessions[0]!.id)?.output).toBe(
      "Codex results",
    );
    expect(comparison.errors.get(comparison.sessions[1]!.id)?.error).toBe(
      "Claude API timeout",
    );
  });

  it("marks complete when both sessions finish", () => {
    const comparison = ComparisonSession.create({
      threadId: "thread_1",
      adapterIds: ["codex", "claude"],
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
      prompt: "test",
    });

    comparison.markSessionCompleted(comparison.sessions[0]!.id, {
      exitCode: 0,
      output: "Codex",
    });

    comparison.markSessionCompleted(comparison.sessions[1]!.id, {
      exitCode: 0,
      output: "Claude",
    });

    expect(comparison.status).toBe("completed");
  });
});
