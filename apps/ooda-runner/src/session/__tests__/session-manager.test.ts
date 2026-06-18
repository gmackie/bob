import { describe, expect, it } from "vitest";

import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  it("creates a session with explicit adapter and tool profile ids", () => {
    const manager = new SessionManager();

    const session = manager.createSession({
      threadId: "thread_sleep",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: ["general-research"],
      workspaceRoot: "/tmp/threads/thread_sleep",
    });

    expect(session.id).toBeDefined();
    expect(session.threadId).toBe("thread_sleep");
    expect(session.adapterId).toBe("codex");
    expect(session.toolProfileId).toBe("research-light");
    expect(session.status).toBe("pending");
  });

  it("lists active sessions", () => {
    const manager = new SessionManager();

    manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/threads/thread_1",
    });

    manager.createSession({
      threadId: "thread_2",
      adapterId: "claude",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/threads/thread_2",
    });

    expect(manager.listSessions()).toHaveLength(2);
  });

  it("retrieves a session by id", () => {
    const manager = new SessionManager();

    const session = manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/threads/thread_1",
    });

    const found = manager.getSession(session.id);
    expect(found).toBeDefined();
    expect(found!.threadId).toBe("thread_1");
  });

  it("updates session status", () => {
    const manager = new SessionManager();

    const session = manager.createSession({
      threadId: "thread_1",
      adapterId: "codex",
      toolProfileId: "research-light",
      sourceBundleIds: [],
      workspaceRoot: "/tmp/threads/thread_1",
    });

    manager.updateStatus(session.id, "running");
    expect(manager.getSession(session.id)!.status).toBe("running");

    manager.updateStatus(session.id, "completed");
    expect(manager.getSession(session.id)!.status).toBe("completed");
  });
});
