/**
 * A session, summarised for someone who was not watching.
 *
 * The phone showed the raw event stream and nothing else, so reviewing an
 * autonomous run meant scrolling every tool call to learn whether it finished,
 * what it said last, and whether it was waiting on you. These pin what the
 * summary says in each of those situations.
 */
import { describe, expect, it } from "vitest";

import type { SummaryEventLike } from "./session-summary-model";
import {
  buildKeyMoments,
  buildSessionSummary,
  derivePendingPermission,
  formatElapsed,
  toneForStatus,
} from "./session-summary-model";

const NOW = new Date("2026-09-30T12:10:00.000Z");

let seq = 0;
function ev(
  eventType: string,
  payload: Record<string, unknown>,
  options: { direction?: string; at?: string } = {},
): SummaryEventLike {
  seq += 1;
  return {
    seq,
    eventType,
    direction: options.direction ?? "agent",
    payload,
    createdAt: options.at ?? "2026-09-30T12:00:00.000Z",
  };
}

const session = {
  sessionId: "sess-1234abcd",
  status: "running",
  title: "Implement queue reorder",
  agentType: "codex",
  workItemId: "wi-1",
  workItemIdentifier: "BOB-42",
  lastActivityAt: "2026-09-30T12:08:00.000Z",
};

describe("buildSessionSummary", () => {
  it("names the session by its title and work item, never by its id", () => {
    const summary = buildSessionSummary(
      { session, sessionId: session.sessionId, events: [] },
      { now: NOW },
    );
    expect(summary.title).toBe("Implement queue reorder");
    expect(summary.identifier).toBe("BOB-42");
    expect(summary.agentLabel).toBe("Codex");
  });

  it("falls back to a short id only when the gateway knows nothing about the session", () => {
    const summary = buildSessionSummary(
      { session: null, sessionId: "sess-1234abcd", events: [] },
      { now: NOW },
    );
    expect(summary.title).toBe("Session sess-123");
    expect(summary.status).toBe("unknown");
  });

  it("puts a pending approval above everything else in the headline", () => {
    const events = [
      ev("message_final", { content: "I will now run the tests." }),
      ev("status_change", { status: "blocked" }),
      ev("permission_request", { requestId: "req-1", toolName: "Bash" }),
    ];
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "blocked" },
        sessionId: session.sessionId,
        events,
      },
      { now: NOW },
    );
    expect(summary.tone).toBe("attention");
    expect(summary.headline).toBe("Waiting for approval to use Bash");
    expect(summary.pendingPermission).toEqual({
      requestId: "req-1",
      toolName: "Bash",
    });
  });

  it("surfaces a question the agent asked, with its options, while the run is active", () => {
    const summary = buildSessionSummary(
      {
        session,
        sessionId: session.sessionId,
        events: [],
        workflowState: {
          workflowStatus: "awaiting_input",
          statusMessage: null,
          awaitingInput: {
            question: "Which database should the migration target?",
            options: ["pglite", "postgres"],
            defaultAction: "pglite",
            expiresAt: "2026-09-30T13:00:00.000Z",
          },
        },
      },
      { now: NOW },
    );
    expect(summary.tone).toBe("attention");
    expect(summary.headline).toBe(
      "Asking: Which database should the migration target?",
    );
    expect(summary.awaitingInput?.options).toEqual(["pglite", "postgres"]);
  });

  it("drops a stale question once the session has ended", () => {
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "completed" },
        sessionId: session.sessionId,
        events: [],
        workflowState: {
          workflowStatus: "completed",
          statusMessage: "Done",
          awaitingInput: {
            question: "Old question",
            options: null,
            defaultAction: "skip",
            expiresAt: null,
          },
        },
      },
      { now: NOW },
    );
    expect(summary.awaitingInput).toBeNull();
    expect(summary.tone).toBe("success");
  });

  it("uses the agent's own completion summary as the headline of a finished run", () => {
    const events = [
      ev("message_final", { content: "Working on it." }),
      ev("state", {
        type: "workflow_status",
        workflowStatus: "awaiting_review",
        message: "Added queue reorder with tests; PR is ready.",
        details: { prUrl: "https://git.example/pr/7" },
      }),
      ev("status_change", {
        status: "completed",
        summary: { branch: "feat/reorder" },
      }),
    ];
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "completed" },
        sessionId: session.sessionId,
        events,
      },
      { now: NOW },
    );
    expect(summary.tone).toBe("success");
    expect(summary.headline).toBe(
      "Added queue reorder with tests; PR is ready.",
    );
    expect(summary.pullRequestUrl).toBe("https://git.example/pr/7");
    expect(summary.branch).toBe("feat/reorder");
  });

  it("prefers the server's current status message over an older event", () => {
    const events = [
      ev("state", {
        type: "workflow_status",
        workflowStatus: "working",
        message: "Old",
      }),
    ];
    const summary = buildSessionSummary(
      {
        session,
        sessionId: session.sessionId,
        events,
        workflowState: {
          workflowStatus: "working",
          statusMessage: "Running lint now",
          awaitingInput: null,
        },
      },
      { now: NOW },
    );
    expect(summary.headline).toBe("Running lint now");
  });

  it("leads with the error when a run failed", () => {
    const events = [
      ev("message_final", { content: "Trying again." }),
      ev("error", {
        code: "E_TIMEOUT",
        message: "Command timed out after 600s",
      }),
      ev("status_change", { status: "failed" }),
    ];
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "failed" },
        sessionId: session.sessionId,
        events,
      },
      { now: NOW },
    );
    expect(summary.tone).toBe("failure");
    expect(summary.headline).toBe("E_TIMEOUT: Command timed out after 600s");
    expect(summary.error).toBe("E_TIMEOUT: Command timed out after 600s");
  });

  it("falls back to the session's recorded error when the stream has none", () => {
    const summary = buildSessionSummary(
      {
        session: {
          ...session,
          status: "error",
          lastError: { code: "SPAWN", message: "codex binary not found" },
        },
        sessionId: session.sessionId,
        events: [],
      },
      { now: NOW },
    );
    expect(summary.headline).toBe("SPAWN: codex binary not found");
  });

  it("keeps the last full agent message for reading, and its first line as the headline", () => {
    const events = [
      ev("message_final", {
        content:
          "Refactored the reorder handler.\n\nDetails:\n- moved sort into the model\n- added tests",
      }),
    ];
    const summary = buildSessionSummary(
      { session, sessionId: session.sessionId, events },
      { now: NOW },
    );
    expect(summary.headline).toBe("Refactored the reorder handler.");
    expect(summary.latestMessage).toContain("- added tests");
  });

  it("reads a markdown heading as the lead of the line beneath it", () => {
    const events = [
      ev("message_final", {
        content:
          "## Summary\n\n- **Nodes** now shows cooldowns.\n- Tests added.",
      }),
    ];
    const summary = buildSessionSummary(
      { session, sessionId: session.sessionId, events },
      { now: NOW },
    );
    expect(summary.headline).toBe("Summary: Nodes now shows cooldowns.");
    expect(summary.keyMoments.at(-1)?.text).toBe(
      "Summary: Nodes now shows cooldowns.",
    );
  });

  it("describes the current tool when the agent has not said anything yet", () => {
    const events = [
      ev("tool_call", { name: "Bash", arguments: { command: "pnpm test" } }),
    ];
    const summary = buildSessionSummary(
      { session, sessionId: session.sessionId, events },
      { now: NOW },
    );
    expect(summary.headline).toBe("Running Bash: pnpm test");
  });

  it("is honest about a host that stopped answering", () => {
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "host_unknown" },
        sessionId: session.sessionId,
        events: [],
      },
      { now: NOW },
    );
    expect(summary.tone).toBe("attention");
    expect(summary.headline).toMatch(/Lost contact/);
  });

  it("counts what the run did and how long it took", () => {
    const events = [
      ev(
        "tool_call",
        { name: "Read", arguments: { file_path: "a.ts" } },
        { at: "2026-09-30T12:00:00.000Z" },
      ),
      ev(
        "tool_call",
        { name: "Edit", arguments: { file_path: "a.ts" } },
        { at: "2026-09-30T12:01:00.000Z" },
      ),
      ev(
        "tool_call",
        { name: "Edit", arguments: JSON.stringify({ file_path: "a.ts" }) },
        { at: "2026-09-30T12:01:30.000Z" },
      ),
      ev(
        "tool_call",
        { name: "Write", arguments: { file_path: "b.ts" } },
        { at: "2026-09-30T12:02:00.000Z" },
      ),
      ev(
        "tool_result",
        { toolCallId: "x", result: "boom", isError: true },
        { at: "2026-09-30T12:02:10.000Z" },
      ),
      ev(
        "message_final",
        { content: "Done." },
        { at: "2026-09-30T12:03:00.000Z" },
      ),
      ev(
        "status_change",
        { status: "completed" },
        { at: "2026-09-30T12:03:05.000Z" },
      ),
    ];
    const summary = buildSessionSummary(
      {
        session: { ...session, status: "completed" },
        sessionId: session.sessionId,
        events,
      },
      { now: NOW },
    );
    expect(summary.counts).toEqual({
      toolCalls: 4,
      messages: 1,
      errors: 1,
      filesEdited: 2,
    });
    // Finished runs measure to their last event, not to now.
    expect(summary.elapsedLabel).toBe("3m 05s");
    // The gateway's own lastActivityAt (12:08) is newer than the last event
    // (12:03); whichever is newer is the honest answer.
    expect(summary.lastActivityLabel).toBe("2m ago");
  });

  it("measures a live run up to now", () => {
    const events = [
      ev("tool_call", { name: "Bash" }, { at: "2026-09-30T11:00:00.000Z" }),
    ];
    const summary = buildSessionSummary(
      { session, sessionId: session.sessionId, events },
      { now: NOW },
    );
    expect(summary.elapsedLabel).toBe("1h 10m");
  });

  it("trusts the durable status_change row when the gateway snapshot has no entry", () => {
    const events = [ev("status_change", { status: "completed" })];
    const summary = buildSessionSummary(
      { session: null, sessionId: "sess-x", events },
      { now: NOW },
    );
    expect(summary.status).toBe("completed");
    expect(summary.isActive).toBe(false);
  });
});

describe("buildKeyMoments", () => {
  it("keeps decisions, status changes, errors and messages, and drops the chatter", () => {
    const events = [
      ev("output_chunk", { content: "…" }),
      ev("tool_call", { name: "Read", arguments: { file_path: "a.ts" } }),
      ev("tool_result", { result: "contents" }),
      ev("status_change", { status: "running" }),
      ev("permission_request", { requestId: "r1", toolName: "Bash" }),
      ev("permission_resolved", { requestId: "r1", decision: "allow" }),
      ev(
        "input",
        { content: "Use the postgres driver" },
        { direction: "client" },
      ),
      ev("check", {
        phase: "test",
        status: "failed",
        counts: { failed: 2, passed: 10 },
      }),
      ev("check", { phase: "lint", status: "passed" }),
      ev("error", { message: "flaky" }),
      ev("message_final", { content: "Fixed the flaky test.\nMore detail." }),
      ev("state", {
        type: "workflow_status",
        workflowStatus: "completed",
        message: "All green.",
      }),
      ev("status_change", { status: "completed" }),
    ];
    const moments = buildKeyMoments(events);
    expect(moments.map((m) => `${m.label}: ${m.text}`)).toEqual([
      "Status: Running",
      "Approval requested: Wants to use Bash",
      "Approval resolved: Approved",
      "You: Use the postgres driver",
      "Check failed: test: 2 failed",
      "Error: flaky",
      "Agent: Fixed the flaky test.",
      "Completed: All green.",
      "Status: Completed",
    ]);
    expect(moments.find((m) => m.kind === "check")?.tone).toBe("failure");
    expect(moments.find((m) => m.label === "Completed")?.tone).toBe("success");
  });

  it("explains why a sweep ended a run", () => {
    const moments = buildKeyMoments([
      ev("status_change", {
        status: "interrupted",
        summary: { reaped: true, reap_reason: "host lease expired" },
      }),
    ]);
    expect(moments[0]?.text).toBe("Interrupted — host lease expired");
  });

  it("keeps only the newest moments so a long run stays readable", () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev("message_final", { content: `m${i}` }),
    );
    const moments = buildKeyMoments(events, 5);
    expect(moments.map((m) => m.text)).toEqual([
      "m35",
      "m36",
      "m37",
      "m38",
      "m39",
    ]);
  });
});

describe("derivePendingPermission", () => {
  it("returns the newest unresolved request", () => {
    const events = [
      ev("status_change", { status: "blocked" }),
      ev("permission_request", { requestId: "a", toolName: "Bash" }),
      ev("permission_request", { requestId: "b", toolName: "Write" }),
      ev("permission_resolved", { requestId: "b" }),
    ];
    expect(derivePendingPermission(events)).toEqual({
      requestId: "a",
      toolName: "Bash",
    });
  });

  it("clears once the run leaves blocked, even if a request was never resolved", () => {
    const events = [
      ev("permission_request", { requestId: "a" }),
      ev("status_change", { status: "running" }),
    ];
    expect(derivePendingPermission(events)).toBeNull();
  });
});

describe("toneForStatus / formatElapsed", () => {
  it("maps runner statuses to what they mean for a person", () => {
    expect(toneForStatus("running")).toBe("running");
    expect(toneForStatus("blocked")).toBe("attention");
    expect(toneForStatus("host_unknown")).toBe("attention");
    expect(toneForStatus("completed")).toBe("success");
    expect(toneForStatus("interrupted")).toBe("failure");
    expect(toneForStatus("stopped")).toBe("idle");
  });

  it("formats durations at the precision a person reads", () => {
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_900_000)).toBe("1h 05m");
  });
});
