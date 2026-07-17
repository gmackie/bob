import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { SessionManager } from "../session/session-manager";
import { RunnerServer } from "../runner-server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Runner Lifecycle", () => {
  it("registers adapter and host platform capabilities for scheduler routing", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-runner-"));
    const originalCursorApiKey = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-key";
    try {
      const register = vi.fn().mockResolvedValue([{ id: "runner-device-1" }]);
      const server = new RunnerServer({
        storageRoot,
        serverUrl: "http://localhost:3000",
        runnerName: "gmacko-mini",
        port: 3001,
        bobDevDir: "/tmp",
        bobMaxConcurrent: 2,
      } as any);

      (server as any).trpc = {
        runner: {
          register: {
            mutate: register,
          },
        },
      };

      await (server as any).register();

      const os = platform();
      const expectedPlatformCapabilities =
        os === "darwin" ? ["macos", "darwin"] : [os];
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "gmacko-mini",
          capabilities: expect.arrayContaining([
            "codex",
            "claude",
            "cursor-agent",
            ...expectedPlatformCapabilities,
          ]),
        }),
      );
    } finally {
      if (originalCursorApiKey) {
        process.env.CURSOR_API_KEY = originalCursorApiKey;
      } else {
        delete process.env.CURSOR_API_KEY;
      }
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

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

  it("reports live t3code backend health in Bob heartbeat metadata", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-runner-"));
    const heartbeat = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          authenticated: true,
          auth: { sessionCookieName: "t3_session_3773" },
          scopes: ["orchestration:read", "orchestration:operate"],
        }),
        { status: 200 },
      ),
    );

    try {
      const server = new RunnerServer({
        storageRoot,
        serverUrl: "http://localhost:3000",
        runnerName: "gmacko-mini",
        port: 3001,
        bobDevDir: "/tmp",
        bobMaxConcurrent: 4,
        t3codeServerUrl: "http://127.0.0.1:3774",
        t3codeAuthToken: "t3-token",
        t3codeProjectId: "t3-project-1",
        t3codeModelInstanceId: "codex",
        t3codeModel: "gpt-5.4",
        t3codeWorktreePath: "/Users/mackieg/src/bob",
        t3codeRuntimeMode: "full-access",
      } as any);

      (server as any).bobReporter = {
        heartbeat,
      };

      await (server as any).publishBobHeartbeat();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:3774/api/auth/session",
        expect.objectContaining({
          headers: { Authorization: "Bearer t3-token" },
        }),
      );
      expect(heartbeat).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.objectContaining({
            t3code: expect.objectContaining({
              status: "online",
              httpStatus: 200,
              authenticated: true,
              endpointMode: "loopback",
              runnerStorageRoot: storageRoot,
              worktreePath: "/Users/mackieg/src/bob",
              sessionCookieName: "t3_session_3773",
              scopes: ["orchestration:read", "orchestration:operate"],
            }),
          }),
        }),
      );
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
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

  it("leaves t3-dispatched sessions running until mirrored t3 events complete them", async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "ooda-runner-"));
    const updateSessionStatus = vi.fn();
    const pushSessionEvent = vi.fn();
    const finishRun = vi.fn();
    const server = new RunnerServer({
      storageRoot,
      serverUrl: "http://localhost:3000",
      runnerName: "test-runner",
      port: 3001,
      bobDevDir: "/tmp",
      bobMaxConcurrent: 2,
      t3codeServerUrl: "https://t3.example.com",
      t3codeProjectId: "t3-project-1",
      t3codeModelInstanceId: "codex",
      t3codeModel: "gpt-5",
    } as any);

    (server as any).trpc = {
      runner: {
        getSessionEvents: {
          query: vi.fn().mockResolvedValue([
            { id: "event-1", type: "prompt", content: "Research through t3" },
          ]),
        },
        pushSessionEvent: {
          mutate: pushSessionEvent.mockResolvedValue(undefined),
        },
        updateSessionStatus: {
          mutate: updateSessionStatus.mockResolvedValue(undefined),
        },
      },
      threads: {
        byId: {
          query: vi.fn().mockResolvedValue({
            id: "thread-1",
            slug: "thread-one",
            title: "Thread One",
          }),
        },
      },
    };
    (server as any).bobReporter = {
      startRun: vi.fn().mockResolvedValue("bob-run-1"),
      pushLog: vi.fn().mockResolvedValue(undefined),
      finishRun: finishRun.mockResolvedValue(undefined),
    };
    (server as any).createExecutor = vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        threadDir: join(storageRoot, "thread-one"),
        rawOutput: "Dispatched OODA session to t3code thread ooda-session-session-1",
        agentResponse: "Dispatched OODA session to t3code thread ooda-session-session-1",
        dispatchedToT3Code: true,
      }),
    });

    await (server as any).executeSession({
      id: "session-1",
      threadId: "thread-1",
      adapterId: "codex",
      toolProfileId: "research-light",
    });

    expect(updateSessionStatus).not.toHaveBeenCalled();
    expect(finishRun).not.toHaveBeenCalledWith(
      "bob-run-1",
      "completed",
      expect.anything(),
    );

    rmSync(storageRoot, { recursive: true, force: true });
  });
});
