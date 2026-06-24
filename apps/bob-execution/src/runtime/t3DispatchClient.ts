import { randomUUID } from "node:crypto";

import type { BobExternalTaskMetadata } from "./externalTaskMetadata.js";
import type { PlanningTask } from "./taskExecutor.js";

export interface T3DispatchConfig {
  projectId: string;
  modelInstanceId: string;
  model: string;
  runtimeMode?: "approval-required" | "auto-accept-edits" | "full-access";
}

export interface T3DispatchRuntimeConfig extends T3DispatchConfig {
  serverUrl: string;
  authToken?: string;
}

function readRuntimeValue(key: string): string | undefined {
  const globalValue = (globalThis as any)[key];
  if (typeof globalValue === "string" && globalValue.trim()) {
    return globalValue.trim();
  }
  const envValue = process.env[key];
  if (typeof envValue === "string" && envValue.trim()) {
    return envValue.trim();
  }
  return undefined;
}

function normalizeRuntimeMode(
  value: string | undefined,
): T3DispatchConfig["runtimeMode"] {
  if (
    value === "approval-required" ||
    value === "auto-accept-edits" ||
    value === "full-access"
  ) {
    return value;
  }
  return undefined;
}

export function getT3DispatchRuntimeConfig(): T3DispatchRuntimeConfig | null {
  const serverUrl = readRuntimeValue("T3CODE_SERVER_URL");
  const projectId = readRuntimeValue("T3CODE_PROJECT_ID");
  const modelInstanceId = readRuntimeValue("T3CODE_MODEL_INSTANCE_ID");
  const model = readRuntimeValue("T3CODE_MODEL");

  if (!serverUrl || !projectId || !modelInstanceId || !model) {
    return null;
  }

  return {
    serverUrl,
    authToken: readRuntimeValue("T3CODE_AUTH_TOKEN"),
    projectId,
    modelInstanceId,
    model,
    runtimeMode: normalizeRuntimeMode(readRuntimeValue("T3CODE_RUNTIME_MODE")),
  };
}

export interface BuildT3ThreadTurnStartCommandInput {
  task: PlanningTask;
  taskRunId: string;
  branch: string;
  workingDirectory: string;
  baseBranch: string;
  externalTask: BobExternalTaskMetadata;
  config: T3DispatchConfig;
  now?: () => string;
  makeId?: (prefix: "command" | "thread" | "message") => string;
}

function defaultMakeId(prefix: "command" | "thread" | "message") {
  return `${prefix}-${randomUUID()}`;
}

function buildInitialPrompt(task: PlanningTask): string {
  return [
    `${task.identifier}: ${task.title}`,
    "",
    task.description?.trim() || "No description provided.",
  ].join("\n");
}

function buildModelSelection(config: T3DispatchConfig) {
  return {
    instanceId: config.modelInstanceId,
    model: config.model,
  };
}

function buildThreadTitle(task: PlanningTask) {
  return `${task.identifier}: ${task.title}`;
}

export function buildT3ThreadCreateCommand(
  input: BuildT3ThreadTurnStartCommandInput,
) {
  const now = input.now?.() ?? new Date().toISOString();
  const makeId = input.makeId ?? defaultMakeId;
  const title = buildThreadTitle(input.task);

  return {
    type: "thread.create" as const,
    commandId: makeId("command"),
    threadId: makeId("thread"),
    projectId: input.config.projectId,
    title,
    modelSelection: buildModelSelection(input.config),
    runtimeMode: input.config.runtimeMode ?? "full-access",
    interactionMode: "default" as const,
    branch: input.branch,
    worktreePath: input.workingDirectory,
    externalTask: input.externalTask,
    createdAt: now,
  };
}

export function buildT3ThreadTurnStartCommand(
  input: BuildT3ThreadTurnStartCommandInput & { threadId: string },
) {
  const now = input.now?.() ?? new Date().toISOString();
  const makeId = input.makeId ?? defaultMakeId;
  const title = buildThreadTitle(input.task);

  return {
    type: "thread.turn.start" as const,
    commandId: makeId("command"),
    threadId: input.threadId,
    message: {
      messageId: makeId("message"),
      role: "user" as const,
      text: buildInitialPrompt(input.task),
      attachments: [],
    },
    modelSelection: buildModelSelection(input.config),
    titleSeed: title,
    runtimeMode: input.config.runtimeMode ?? "full-access",
    interactionMode: "default" as const,
    bootstrap: {
      prepareWorktree: {
        projectCwd: input.workingDirectory,
        baseBranch: input.baseBranch,
        branch: input.branch,
      },
      runSetupScript: false,
    },
    externalTask: input.externalTask,
    createdAt: now,
  };
}

export async function dispatchTaskToT3Code(input: {
  serverUrl: string;
  authToken?: string;
  commands: Array<Record<string, unknown>>;
}): Promise<unknown> {
  const url = new URL(input.serverUrl);
  url.pathname = "/api/orchestration/dispatch";
  url.search = "";
  url.hash = "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.authToken) {
    headers.Authorization = `Bearer ${input.authToken}`;
  }

  let lastResponse: unknown = null;
  for (const command of input.commands) {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`t3code dispatch failed: ${response.status} ${await response.text()}`);
    }

    lastResponse = await response.json();
  }

  return lastResponse;
}
