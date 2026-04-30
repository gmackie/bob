import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "../session/session-manager";

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
