import { describe, expect, it, vi } from "vitest";

import {
  buildOodaT3ThreadTurnStartCommand,
  dispatchOodaSessionToT3Code,
  getOodaT3DispatchRuntimeConfig,
} from "./t3-dispatch";

describe("OODA t3 dispatch", () => {
  it("builds a t3 thread command with OODA and optional Linear metadata", () => {
    const command = buildOodaT3ThreadTurnStartCommand({
      threadId: "thread-1",
      threadSlug: "market-map",
      threadTitle: "Market Map",
      sessionId: "session-1",
      prompt: "Research the market",
      workspaceRoot: "/tmp/ooda/market-map",
      externalTask: {
        origin: "ooda",
        oodaThreadId: "thread-1",
        oodaThreadSlug: "market-map",
        oodaSessionId: "session-1",
        linearIssueId: "linear-1",
        linearIdentifier: "ENG-42",
        linearUrl: "https://tasks.gmac.io/acme/issue/ENG-42/title",
        linearWebBaseUrl: "https://tasks.gmac.io",
      },
      config: {
        projectId: "t3-project-1",
        modelInstanceId: "codex",
        model: "gpt-5",
      },
      now: () => "2026-06-04T00:00:00.000Z",
      makeId: (prefix) => `${prefix}-1`,
    });

    expect(command.type).toBe("thread.turn.start");
    expect(command.threadId).toBe("thread-1");
    expect(command.bootstrap.createThread.externalTask).toMatchObject({
      origin: "ooda",
      oodaThreadId: "thread-1",
      linearIdentifier: "ENG-42",
      linearWebBaseUrl: "https://tasks.gmac.io",
    });
    expect(command.bootstrap.createThread.projectId).toBe("t3-project-1");
    expect(command.message.text).toContain("Research the market");
  });

  it("reads t3 runtime config from OODA-specific env first", () => {
    vi.stubEnv("OODA_T3CODE_SERVER_URL", "https://t3.example.com");
    vi.stubEnv("OODA_T3CODE_PROJECT_ID", "ooda-project");
    vi.stubEnv("OODA_T3CODE_MODEL_INSTANCE_ID", "codex");
    vi.stubEnv("OODA_T3CODE_MODEL", "gpt-5");
    vi.stubEnv("OODA_T3CODE_AUTH_TOKEN", "secret");
    vi.stubEnv("OODA_T3CODE_RUNTIME_MODE", "approval-required");

    expect(getOodaT3DispatchRuntimeConfig()).toEqual({
      serverUrl: "https://t3.example.com",
      authToken: "secret",
      projectId: "ooda-project",
      modelInstanceId: "codex",
      model: "gpt-5",
      runtimeMode: "approval-required",
    });
  });

  it("posts to the t3 orchestration endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dispatchOodaSessionToT3Code({
        serverUrl: "https://t3.example.com/base",
        authToken: "token-1",
        command: { type: "thread.turn.start" },
      }),
    ).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://t3.example.com/api/orchestration/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
      }),
    );
  });

  it("creates bootstrap threads before starting the first turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sequence: 1 }),
        text: async () => "ok",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Thread 'thread-1' does not exist for command 'thread.turn.start'.",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sequence: 2 }),
        text: async () => "ok",
      });
    vi.stubGlobal("fetch", fetchMock);

    await dispatchOodaSessionToT3Code({
      serverUrl: "https://t3.example.com/base",
      authToken: "token-1",
      command: {
        type: "thread.turn.start",
        commandId: "command-1",
        threadId: "thread-1",
        message: {
          messageId: "message-1",
          role: "user",
          text: "hello",
          attachments: [],
        },
        bootstrap: {
          createThread: {
            projectId: "project-1",
            title: "Thread 1",
            modelSelection: { instanceId: "codex", model: "gpt-5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: "ooda/thread-1",
            worktreePath: "/tmp/thread-1",
            createdAt: "2026-06-04T00:00:00.000Z",
          },
        },
        createdAt: "2026-06-04T00:00:00.000Z",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const firstTurnBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(firstBody).toMatchObject({
      type: "thread.create",
      commandId: "command-1.thread-create",
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread 1",
    });
    expect(secondBody).toMatchObject({
      type: "thread.turn.start",
      commandId: "command-1",
      threadId: "thread-1",
    });
    expect(firstTurnBody).toMatchObject(secondBody);
    expect(secondBody.bootstrap).toBeUndefined();
  });
});
