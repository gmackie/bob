import { randomUUID } from "node:crypto";

export interface OodaExternalTaskMetadata {
  origin: "ooda";
  oodaThreadId: string;
  oodaThreadSlug: string;
  oodaSessionId: string;
  linearIssueId?: string;
  linearIdentifier?: string;
  linearUrl?: string;
  linearWebBaseUrl?: string;
}

export interface OodaT3DispatchConfig {
  projectId: string;
  modelInstanceId: string;
  model: string;
  runtimeMode?: "approval-required" | "auto-accept-edits" | "full-access";
}

export interface OodaT3DispatchRuntimeConfig extends OodaT3DispatchConfig {
  serverUrl: string;
  authToken?: string;
}

function readRuntimeValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const globalValue = (globalThis as any)[key];
    if (typeof globalValue === "string" && globalValue.trim()) {
      return globalValue.trim();
    }
    const envValue = process.env[key];
    if (typeof envValue === "string" && envValue.trim()) {
      return envValue.trim();
    }
  }
  return undefined;
}

function normalizeRuntimeMode(
  value: string | undefined,
): OodaT3DispatchConfig["runtimeMode"] {
  if (
    value === "approval-required" ||
    value === "auto-accept-edits" ||
    value === "full-access"
  ) {
    return value;
  }
  return undefined;
}

export function getOodaT3DispatchRuntimeConfig(): OodaT3DispatchRuntimeConfig | null {
  const serverUrl = readRuntimeValue("OODA_T3CODE_SERVER_URL", "T3CODE_SERVER_URL");
  const projectId = readRuntimeValue("OODA_T3CODE_PROJECT_ID", "T3CODE_PROJECT_ID");
  const modelInstanceId = readRuntimeValue(
    "OODA_T3CODE_MODEL_INSTANCE_ID",
    "T3CODE_MODEL_INSTANCE_ID",
  );
  const model = readRuntimeValue("OODA_T3CODE_MODEL", "T3CODE_MODEL");

  if (!serverUrl || !projectId || !modelInstanceId || !model) {
    return null;
  }

  return {
    serverUrl,
    authToken: readRuntimeValue("OODA_T3CODE_AUTH_TOKEN", "T3CODE_AUTH_TOKEN"),
    projectId,
    modelInstanceId,
    model,
    runtimeMode: normalizeRuntimeMode(
      readRuntimeValue("OODA_T3CODE_RUNTIME_MODE", "T3CODE_RUNTIME_MODE"),
    ),
  };
}

function defaultMakeId(prefix: "command" | "thread" | "message") {
  return `${prefix}-${randomUUID()}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildOodaT3ThreadTurnStartCommand(input: {
  threadId: string;
  threadSlug: string;
  threadTitle: string;
  sessionId: string;
  prompt: string;
  workspaceRoot: string;
  externalTask: OodaExternalTaskMetadata;
  config: OodaT3DispatchConfig;
  now?: () => string;
  makeId?: (prefix: "command" | "thread" | "message") => string;
}) {
  const now = input.now?.() ?? new Date().toISOString();
  const makeId = input.makeId ?? defaultMakeId;
  const runtimeMode = input.config.runtimeMode ?? "full-access";
  const modelSelection = {
    instanceId: input.config.modelInstanceId,
    model: input.config.model,
  };

  return {
    type: "thread.turn.start" as const,
    commandId: makeId("command"),
    threadId: makeId("thread"),
    message: {
      messageId: makeId("message"),
      role: "user" as const,
      text: input.prompt,
      attachments: [],
    },
    modelSelection,
    titleSeed: input.threadTitle,
    runtimeMode,
    interactionMode: "default" as const,
    bootstrap: {
      createThread: {
        projectId: input.config.projectId,
        title: input.threadTitle,
        modelSelection,
        runtimeMode,
        interactionMode: "default" as const,
        branch: `ooda/${input.threadSlug}`,
        worktreePath: input.workspaceRoot,
        externalTask: input.externalTask,
        createdAt: now,
      },
      runSetupScript: false,
    },
    externalTask: input.externalTask,
    createdAt: now,
  };
}

export async function dispatchOodaSessionToT3Code(input: {
  serverUrl: string;
  authToken?: string;
  command: Record<string, unknown>;
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

  const postCommand = async (command: Record<string, unknown>) => {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`t3code dispatch failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  };

  const postTurnStartAfterThreadCreate = async (
    command: Record<string, unknown>,
    threadId: unknown,
  ) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(command),
      });
      if (response.ok) {
        return response.json();
      }
      const text = await response.text();
      const missingThread =
        response.status === 500 &&
        typeof threadId === "string" &&
        text.includes("does not exist") &&
        text.includes(threadId);
      if (!missingThread) {
        throw new Error(`t3code dispatch failed: ${response.status} ${text}`);
      }
      await sleep(100);
    }
    throw new Error(`t3code thread ${String(threadId)} was not visible before turn start`);
  };

  const bootstrapCreateThread =
    input.command.type === "thread.turn.start" &&
    input.command.bootstrap &&
    typeof input.command.bootstrap === "object" &&
    !Array.isArray(input.command.bootstrap)
      ? (input.command.bootstrap as Record<string, unknown>).createThread
      : undefined;

  if (
    bootstrapCreateThread &&
    typeof bootstrapCreateThread === "object" &&
    !Array.isArray(bootstrapCreateThread)
  ) {
    await postCommand({
      ...(bootstrapCreateThread as Record<string, unknown>),
      type: "thread.create",
      commandId: `${String(input.command.commandId ?? "ooda-command")}.thread-create`,
      threadId: input.command.threadId,
    });

    const { bootstrap: _bootstrap, ...turnStartCommand } = input.command;
    return postTurnStartAfterThreadCreate(turnStartCommand, input.command.threadId);
  }

  return postCommand(input.command);
}
