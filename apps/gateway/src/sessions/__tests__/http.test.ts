import { describe, expect, it, vi } from "vitest";

import {
  sendSessionMessageFromHttp,
  startSessionFromHttp,
} from "../http.js";

function createActor(overrides?: Partial<{
  userId: string;
  sessionId: string;
  status: string;
}>) {
  let status = overrides?.status ?? "stopped";

  return {
    userId: overrides?.userId ?? "user-1",
    sessionId: overrides?.sessionId ?? "session-1",
    getStatus: vi.fn(() => status),
    setStatus: vi.fn((next: string) => {
      status = next;
    }),
    handleInput: vi.fn(() => 7),
  };
}

function createSessionManager(actor: ReturnType<typeof createActor> | null) {
  return {
    getSession: vi.fn(() => actor),
    getOrLoadSession: vi.fn(async () => actor),
  };
}

describe("gateway hosted session HTTP helpers", () => {
  it("starts an owned session through the shared gateway start path", async () => {
    const actor = createActor();
    const sessionManager = createSessionManager(actor);
    const startAgentForSession = vi.fn(async () => {
      actor.setStatus("running");
    });

    const result = await startSessionFromHttp(
      {
        userId: "user-1",
        sessionId: "session-1",
        initialPrompt: "Implement the task",
      },
      {
        sessionManager: sessionManager as never,
        agentProcessManager: { isManaging: vi.fn(() => false) } as never,
        startAgentForSession,
      },
    );

    expect(actor.setStatus).toHaveBeenCalledWith("provisioning");
    expect(startAgentForSession).toHaveBeenCalledWith(
      actor,
      "user-1",
      "Implement the task",
    );
    expect(result).toEqual({ sessionId: "session-1", status: "running" });
  });

  it("returns the current session when it is already running", async () => {
    const actor = createActor({ status: "running" });
    const sessionManager = createSessionManager(actor);
    const startAgentForSession = vi.fn();

    const result = await startSessionFromHttp(
      {
        userId: "user-1",
        sessionId: "session-1",
      },
      {
        sessionManager: sessionManager as never,
        agentProcessManager: { isManaging: vi.fn(() => true) } as never,
        startAgentForSession,
      },
    );

    expect(startAgentForSession).not.toHaveBeenCalled();
    expect(result).toEqual({ sessionId: "session-1", status: "running" });
  });

  it("records and forwards hosted session messages into the managed process", async () => {
    const actor = createActor({ status: "running" });
    const sessionManager = createSessionManager(actor);
    const agentProcessManager = {
      isManaging: vi.fn(() => true),
      sendInput: vi.fn(() => true),
    };

    const result = await sendSessionMessageFromHttp(
      {
        userId: "user-1",
        sessionId: "session-1",
        message: "Continue with the review feedback",
      },
      {
        sessionManager: sessionManager as never,
        agentProcessManager: agentProcessManager as never,
      },
    );

    expect(actor.handleInput).toHaveBeenCalledTimes(1);
    const [, clientInputId] = actor.handleInput.mock.calls[0] ?? [];
    expect(clientInputId).toMatch(/^http-/);
    expect(agentProcessManager.sendInput).toHaveBeenCalledWith(
      "session-1",
      "Continue with the review feedback",
    );
    expect(result).toEqual({
      sessionId: "session-1",
      acceptedSeq: 7,
      delivered: true,
    });
  });

  it("rejects access to another user's session", async () => {
    const actor = createActor({ userId: "user-2" });
    const sessionManager = createSessionManager(actor);

    await expect(
      startSessionFromHttp(
        {
          userId: "user-1",
          sessionId: "session-1",
        },
        {
          sessionManager: sessionManager as never,
          agentProcessManager: { isManaging: vi.fn(() => false) } as never,
          startAgentForSession: vi.fn(),
        },
      ),
    ).rejects.toThrow("does not belong to user user-1");
  });

  it("restarts a running session when no stdio process is attached", async () => {
    const actor = createActor({ status: "running" });
    const sessionManager = createSessionManager(actor);
    const startAgentForSession = vi.fn(async () => {
      actor.setStatus("running");
    });

    const result = await startSessionFromHttp(
      {
        userId: "user-1",
        sessionId: "session-1",
      },
      {
        sessionManager: sessionManager as never,
        agentProcessManager: { isManaging: vi.fn(() => false) } as never,
        startAgentForSession,
      },
    );

    expect(actor.setStatus).toHaveBeenCalledWith("provisioning");
    expect(startAgentForSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sessionId: "session-1", status: "running" });
  });

  it("rejects hosted session sends when no stdio process is attached", async () => {
    const actor = createActor({ status: "running" });
    const sessionManager = createSessionManager(actor);

    await expect(
      sendSessionMessageFromHttp(
        {
          userId: "user-1",
          sessionId: "session-1",
          message: "Continue with T3",
        },
        {
          sessionManager: sessionManager as never,
          agentProcessManager: {
            isManaging: vi.fn(() => false),
            sendInput: vi.fn(() => false),
          } as never,
        },
      ),
    ).rejects.toThrow("not attached to a stdio agent process");
  });
});
