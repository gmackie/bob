import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildT3ThreadCreateCommand,
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
      delete (globalThis as Record<string, unknown>)[key];
      delete process.env[key];
    }
  });

  it("builds a thread create command for the target project and repo path", () => {
    const command = buildT3ThreadCreateCommand({
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
      taskRunId: "task-run-1",
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
      type: "thread.create",
      commandId: "command-id",
      threadId: "thread-id",
      projectId: "t3-project-1",
      title: "ENG-42: Replace Bob runner",
      branch: "bob/ENG-42/replace-bob-runner",
      worktreePath: "/repo",
      externalTask,
    });
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
      taskRunId: "task-run-1",
      threadId: "thread-id",
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

    // `message.text` is checked separately with a plain string assertion
    // (rather than `expect.stringContaining(...)` inside this
    // `toMatchObject`) -- vitest's asymmetric matchers are declared to
    // return `any`, which trips no-unsafe-member-access when the object
    // literal is checked against `command`'s real inferred type.
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
        attachments: [],
      },
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5",
      },
      bootstrap: {
        prepareWorktree: {
          projectCwd: "/repo",
          baseBranch: "main",
          branch: "bob/ENG-42/replace-bob-runner",
        },
        runSetupScript: false,
      },
    });
    expect(command.message.text).toContain("ENG-42: Replace Bob runner");
  });

  it("posts commands to the t3code orchestration endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sequence: 7 }),
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await dispatchTaskToT3Code({
      serverUrl: "https://t3.example.com/",
      authToken: "token-1",
      commands: [
        {
          type: "thread.create",
          commandId: "command-1",
        },
        {
          type: "thread.turn.start",
          commandId: "command-2",
        },
      ],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://t3.example.com/api/orchestration/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-1",
        },
        body: JSON.stringify({
          type: "thread.create",
          commandId: "command-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://t3.example.com/api/orchestration/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token-1",
        },
        body: JSON.stringify({
          type: "thread.turn.start",
          commandId: "command-2",
        }),
      }),
    );
  });

  it("requires t3code server, project, and model config", () => {
    expect(getT3DispatchRuntimeConfig()).toBeNull();

    (globalThis as Record<string, unknown>).T3CODE_SERVER_URL = "https://t3.example.com";
    (globalThis as Record<string, unknown>).T3CODE_PROJECT_ID = "t3-project-1";
    (globalThis as Record<string, unknown>).T3CODE_MODEL_INSTANCE_ID = "codex";
    (globalThis as Record<string, unknown>).T3CODE_MODEL = "gpt-5";
    (globalThis as Record<string, unknown>).T3CODE_AUTH_TOKEN = "token-1";
    (globalThis as Record<string, unknown>).T3CODE_RUNTIME_MODE = "auto-accept-edits";

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
