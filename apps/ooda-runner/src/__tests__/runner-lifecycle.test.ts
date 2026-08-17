import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "../session/session-manager";
import { observeOodaPromotion } from "../runner-server";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Runner Lifecycle", () => {
  it("handles session creation during active sessions", () => {
    const manager = new SessionManager();

    const session1 = manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
    });

    manager.updateStatus(session1.id, "running");

    // Can create another session while first is running
    const session2 = manager.createSession({
      threadId: "thread_2",
      adapterId: "claude",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t2",
    });

    expect(manager.listSessions()).toHaveLength(2);
    expect(manager.getSession(session1.id)!.status).toBe("running");
    expect(manager.getSession(session2.id)!.status).toBe("pending");
  });

  it("gracefully handles session cancellation", () => {
    const manager = new SessionManager();

    const session = manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
    });

    manager.updateStatus(session.id, "running");
    manager.updateStatus(session.id, "cancelled");

    expect(manager.getSession(session.id)!.status).toBe("cancelled");
  });

  it("rejects status update for nonexistent session", () => {
    const manager = new SessionManager();

    expect(() =>
      manager.updateStatus("nonexistent", "running"),
    ).toThrow("Session not found");
  });

  it("tracks sessions per thread", () => {
    const manager = new SessionManager();

    manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
    });

    manager.createSession({
      threadId: "thread_1",
      adapterId: "claude",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t1",
    });

    manager.createSession({
      threadId: "thread_2",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/t2",
    });

    const thread1Sessions = manager
      .listSessions()
      .filter((s) => s.threadId === "thread_1");
    expect(thread1Sessions).toHaveLength(2);
  });
});

describe("OODA promotion workflow observation", () => {
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "ooda-skillfleet-promotion-"));
    temporaryDirectories.push(directory);
    return {
      directory,
      journalPath: join(directory, "workflow.jsonl"),
    };
  }

  it("records a successful provenance-backed promotion without retaining raw identities", async () => {
    const { journalPath } = fixture();

    const result = await observeOodaPromotion({
      identity: "raw-promotion-event",
      sessionId: "raw-session-id",
      projectId: "raw-thread-id",
      journalPath,
      operation: async () => ({ noteId: "note_123", artifactId: "sha256:artifact" }),
    });

    expect(result).toEqual({ noteId: "note_123", artifactId: "sha256:artifact" });
    const serialized = readFileSync(journalPath, "utf8");
    expect(JSON.parse(serialized.trim())).toMatchObject({
      source: "ooda",
      provenanceQuality: "direct",
      kind: "engineering_outcome",
      payload: {
        outcomeType: "promotion",
        result: "pass",
      },
    });
    expect(serialized).not.toContain("raw-promotion-event");
    expect(serialized).not.toContain("raw-session-id");
    expect(serialized).not.toContain("raw-thread-id");
  });

  it("records a failed promotion and preserves the original failure", async () => {
    const { journalPath } = fixture();
    const failure = new Error("promotion failed with private detail");

    await expect(observeOodaPromotion({
      identity: "promotion-failure",
      sessionId: "session-failure",
      projectId: "thread-failure",
      journalPath,
      operation: async () => { throw failure; },
    })).rejects.toBe(failure);

    const serialized = readFileSync(journalPath, "utf8");
    expect(JSON.parse(serialized.trim())).toMatchObject({
      kind: "engineering_outcome",
      payload: {
        outcomeType: "promotion",
        result: "fail",
      },
    });
    expect(serialized).not.toContain(failure.message);
  });

  it("does not change a successful promotion when workflow reporting fails", async () => {
    const { directory } = fixture();

    await expect(observeOodaPromotion({
      identity: "promotion-report-failure",
      sessionId: "session-report-failure",
      projectId: null,
      journalPath: directory,
      operation: async () => "promoted",
    })).resolves.toBe("promoted");
  });
});
