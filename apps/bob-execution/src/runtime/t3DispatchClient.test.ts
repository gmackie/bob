import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildT3ThreadTurnStartCommand,
  dispatchTaskToT3Code,
  getT3DispatchRuntimeConfig,
} from "./t3DispatchClient.js";

const externalTask = {
  origin: "bob" as const,
  planningProvider: "linear" as const,
  linearIssueId: "linear-issue-1",
  linearIdentifier: "ENG-42",
  linearTitle: "Replace Bob runner",
  linearUrl: "https://tasks.gmac.io/gmac/issue/ENG-42/replace-bob-runner",
  linearWebBaseUrl: "https://tasks.gmac.io",
  bobWorkspaceId: "workspace-1",
  bobWorkItemId: "work-item-1",
  bobTaskRunId: "task-run-1",
};

describe("t3 dispatch client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const key of [
      "T3CODE_SERVER_URL",
      "T3CODE_AUTH_TOKEN",
      "T3CODE_PROJECT_ID",
      "T3CODE_MODEL_INSTANCE_ID",
      "T3CODE_MODEL",
      "T3CODE_RUNTIME_MODE",
    ]) {
      delete (globalThis as any)[key];
      delete process.env[key];
    }
  });

  it("builds a thread turn start command that asks t3code to prepare the repo worktree", () => {
    const command = buildT3ThreadTurnStartCommand({
      task: {
        id: "work-item-1",
        identifier: "ENG-42",
        title: "Replace Bob runner",
        description: "Use t3code server",
        workspaceId: "workspace-1",
        projectId: "project-1",
        assigneeId: null,
        labels: [],
        priority: 0,
      },
      branch: "bob/ENG-42/replace-bob-runner",
      workingDirectory: "/repo",
      baseBranch: "main",
      externalTask,
      now: () => "2026-06-04T00:00:00.000Z",
      makeId: (prefix) => `${prefix}-id`,
      config: {
        projectId: "t3-project-1",
        modelInstanceId: "codex",
        model: "gpt-5",
        runtimeMode: "full-access",
      },
    });

    expect(command).toMatchObject({
      type: "thread.turn.start",
      commandId: "command-id",
      threadId: "thread-id",
      runtimeMode: "full-access",
      interactionMode: "default",
      externalTask,
      message: {
        messageId: "message-id",
        role: "user",
        text: expect.stringContaining("ENG-42: Replace Bob runner"),
        attachments: [],
      },
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5",
      },
      bootstrap: {
        createThread: {
          projectId: "t3-project-1",
          title: "ENG-42: Replace Bob runner",
          branch: "bob/ENG-42/replace-bob-runner",
          worktreePath: "/repo",
          externalTask,
        },
        prepareWorktree: {
          projectCwd: "/repo",
          baseBranch: "main",
          branch: "bob/ENG-42/replace-bob-runner",
        },
        runSetupScript: true,
      },
    });
  });

  it("posts commands to the t3code orchestration endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sequence: 7 }),
      text: async () => "ok",
    });
    vi.stubGlobal("fetch", fetchMock);

    await dispatchTaskToT3Code({
      serverUrl: "https://t3.example.com/",
      authToken: "token-1",
      command: {
        type: "thread.turn.start",
        commandId: "command-1",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://t3.example.com/api/orchestration/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-1",
        },
      }),
    );
  });

  it("creates bootstrap threads before starting the first turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sequence: 7 }),
        text: async () => "ok",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Thread 'thread-1' does not exist for command 'thread.turn.start'.",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sequence: 8 }),
        text: async () => "ok",
      });
    vi.stubGlobal("fetch", fetchMock);

    await dispatchTaskToT3Code({
      serverUrl: "https://t3.example.com/",
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
            branch: "bob/thread-1",
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

  it("requires t3code server, project, and model config", () => {
    expect(getT3DispatchRuntimeConfig()).toBeNull();

    (globalThis as any).T3CODE_SERVER_URL = "https://t3.example.com";
    (globalThis as any).T3CODE_PROJECT_ID = "t3-project-1";
    (globalThis as any).T3CODE_MODEL_INSTANCE_ID = "codex";
    (globalThis as any).T3CODE_MODEL = "gpt-5";
    (globalThis as any).T3CODE_AUTH_TOKEN = "token-1";
    (globalThis as any).T3CODE_RUNTIME_MODE = "auto-accept-edits";

    expect(getT3DispatchRuntimeConfig()).toEqual({
      serverUrl: "https://t3.example.com",
      authToken: "token-1",
      projectId: "t3-project-1",
      modelInstanceId: "codex",
      model: "gpt-5",
      runtimeMode: "auto-accept-edits",
    });
  });
});
