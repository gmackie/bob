import { describe, expect, it } from "vitest";

import { buildRunRecordView } from "./run-record-model";

const NOW = new Date("2026-09-30T12:00:00.000Z");

describe("buildRunRecordView", () => {
  it("explains a run the sweep ended, since that is the run with no session to read", () => {
    const view = buildRunRecordView(
      {
        id: "run-1",
        status: "interrupted",
        agentType: "codex",
        sessionId: null,
        summary: { reaped: true, reap_reason: "host lease expired" },
        startedAt: "2026-09-30T11:00:00.000Z",
        completedAt: "2026-09-30T11:30:00.000Z",
      },
      { now: NOW },
    );
    expect(view.title).toBe("Codex run");
    expect(view.tone).toBe("failure");
    expect(view.headline).toBe("Ended by the orphan sweep: host lease expired");
    expect(view.facts).toEqual([
      { label: "Started", value: "1h ago" },
      { label: "Finished", value: "30m ago" },
      { label: "Duration", value: "30m 00s" },
      { label: "Swept because", value: "host lease expired" },
    ]);
  });

  it("links the pull request a completed run opened", () => {
    const view = buildRunRecordView(
      {
        id: "run-2",
        status: "completed",
        agentType: "claude",
        sessionId: "sess-1",
        summary: {
          pullRequestUrl: "https://git.example/pr/9",
          branch: "feat/x",
        },
      },
      { now: NOW },
    );
    expect(view.headline).toBe("Completed; opened a pull request");
    expect(view.facts[0]).toEqual({
      label: "Pull request",
      value: "https://git.example/pr/9",
      url: "https://git.example/pr/9",
    });
    expect(view.facts[1]).toEqual({ label: "Branch", value: "feat/x" });
    expect(view.sessionId).toBe("sess-1");
  });

  it("lists artifacts by type and name", () => {
    const view = buildRunRecordView(
      {
        id: "run-3",
        status: "completed",
        artifacts: [
          { id: "a1", type: "test_report", metadata: { name: "vitest.json" } },
          { id: "a2", type: "diff", metadata: null },
        ],
      },
      { now: NOW },
    );
    expect(view.artifacts).toEqual([
      { id: "a1", label: "Test Report", detail: "vitest.json" },
      { id: "a2", label: "Diff", detail: null },
    ]);
  });

  it("says plainly when there is nothing more to read", () => {
    const view = buildRunRecordView(
      { id: "run-4", status: "failed" },
      { now: NOW },
    );
    expect(view.headline).toBe("Failed; this run left no session transcript");
    expect(view.facts).toEqual([]);
  });
});
