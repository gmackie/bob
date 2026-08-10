import { execSync } from "node:child_process";

import { buildCodexMcpConfigArgs } from "./mcp-config";
import { killProcessTree, spawnAdapterProcess } from "./process-tree";
import type {
  AdapterCommand,
  AdapterEvent,
  AdapterExecutionResult,
  AdapterProcessHandle,
  AgentAdapter,
  BuildCommandOptions,
  ExecuteOptions,
  McpServerConfigLike,
  RuntimeCapabilities,
  RuntimeSessionRef,
  RuntimeUsageSnapshot,
  SpawnedProcessLike,
} from "./types";

type RpcId = string | number;
type RpcMessage = {
  jsonrpc?: "2.0";
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingApproval = { rpcId: RpcId; method: string };

const KILL_GRACE_MS = 5_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toolIdentity(item: Record<string, unknown>): {
  id: string;
  name: string;
} {
  return {
    id: stringValue(item.id) ?? "",
    name:
      stringValue(item.type) ??
      stringValue(item.name) ??
      stringValue(item.command) ??
      "codex_tool",
  };
}

function approvalResult(
  method: string,
  behavior: "allow" | "deny",
): Record<string, unknown> | null {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    return { decision: behavior === "allow" ? "accept" : "decline" };
  }
  if (method === "item/tool/requestUserInput" && behavior === "deny") {
    return { answers: {} };
  }
  return null;
}

/**
 * Subscription-backed Codex adapter using the app-server v2 JSON-RPC
 * protocol. The Codex thread id is returned as provider-native operational
 * state; OODA conversation events remain canonical.
 */
export class CodexAdapter implements AgentAdapter {
  id = "codex" as const;
  name = "Codex App Server" as const;
  transport = "stdio" as const;

  private mcpServers: readonly McpServerConfigLike[] = [];

  registerMcpServers(servers: McpServerConfigLike[]): void {
    this.mcpServers = servers;
  }

  capabilities(): RuntimeCapabilities {
    return {
      transport: "app_server",
      supportsResume: true,
      supportsFork: true,
      supportsSteering: true,
      supportsApprovals: true,
      supportsUsageInspection: true,
      authModes: ["subscription", "api_key"],
    };
  }

  isAvailable(): boolean {
    if (process.env.OPENAI_API_KEY) return true;
    try {
      execSync("which codex", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async inspectUsage(
    options?: Pick<ExecuteOptions, "environment" | "spawnImpl">,
  ): Promise<RuntimeUsageSnapshot> {
    const observedAt = new Date().toISOString();
    const childEnvironment = { ...(options?.environment ?? process.env) };
    delete childEnvironment.OPENAI_API_KEY;
    const child: SpawnedProcessLike = options?.spawnImpl
      ? options.spawnImpl("codex", ["app-server"], {
          cwd: process.cwd(),
          env: childEnvironment,
        })
      : (spawnAdapterProcess("codex", ["app-server"], {
          cwd: process.cwd(),
          env: childEnvironment as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
        }) as unknown as SpawnedProcessLike);

    return new Promise<RuntimeUsageSnapshot>((resolve) => {
      let settled = false;
      let buffer = "";
      const finish = (snapshot: RuntimeUsageSnapshot) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdin?.end();
        killProcessTree(child, "SIGTERM");
        resolve(snapshot);
      };
      const fail = (error: unknown) =>
        finish({
          provider: this.id,
          observedAt,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        });
      const send = (message: RpcMessage) =>
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      const timeout = setTimeout(
        () => fail(new Error("Codex rate-limit inspection timed out")),
        10_000,
      );
      timeout.unref?.();

      child.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as RpcMessage;
            if (message.error) {
              fail(
                new Error(message.error.message ?? "Codex app-server error"),
              );
            } else if (message.id === 1) {
              send({ jsonrpc: "2.0", method: "initialized", params: {} });
              send({
                jsonrpc: "2.0",
                id: 2,
                method: "account/rateLimits/read",
                params: {},
              });
            } else if (message.id === 2) {
              const result = record(message.result);
              finish({
                provider: this.id,
                observedAt,
                available: true,
                rateLimits: record(result.rateLimits),
              });
            }
          } catch (error) {
            fail(error);
          }
        }
      });
      child.on("error", fail);
      child.on("close", (code: number | null) => {
        if (!settled)
          fail(
            new Error(
              `Codex app-server exited before usage response (${code ?? "unknown"})`,
            ),
          );
      });
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "ooda-runner",
            title: "OODA Subscription Runtime",
            version: "1.0.0",
          },
          capabilities: { experimentalApi: true },
        },
      });
    });
  }

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    const args = ["app-server"];
    args.push(...buildCodexMcpConfigArgs(this.mcpServers));
    return {
      binary: "codex",
      args,
      cwd: opts.workspaceRoot,
      prompt: opts.prompt,
      runtime: {
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        permissionMode: opts.permissionMode ?? "prompt",
        session: opts.session ?? { mode: "start" },
        billingPolicy: opts.billingPolicy ?? "subscription_preferred",
        authMode:
          opts.authMode ??
          (process.env.OPENAI_API_KEY ? "api_key" : "subscription"),
        correlationId: opts.correlationId,
      },
    };
  }

  async execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<AdapterExecutionResult> {
    const runtime = command.runtime ?? {
      permissionMode: "prompt" as const,
      billingPolicy: "subscription_preferred" as const,
      authMode: "subscription" as const,
      session: { mode: "start" as const },
    };
    const childEnvironment = {
      ...(options?.environment ?? process.env),
      ...command.env,
    };
    // A subscription-only invocation must never silently switch to a metered
    // API key simply because the runner happens to have one in its environment.
    if (runtime.authMode === "subscription")
      delete childEnvironment.OPENAI_API_KEY;

    const child: SpawnedProcessLike = options?.spawnImpl
      ? options.spawnImpl(command.binary, command.args, {
          cwd: command.cwd,
          env: childEnvironment,
        })
      : (spawnAdapterProcess(command.binary, command.args, {
          cwd: command.cwd,
          env: childEnvironment as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
        }) as unknown as SpawnedProcessLike);

    let requestId = 0;
    let lineBuffer = "";
    let threadId: string | undefined;
    let turnId: string | undefined;
    let turnActive = false;
    let completed = false;
    let sawAssistantDelta = false;
    let killTimer: NodeJS.Timeout | undefined;
    const approvals = new Map<string, PendingApproval>();

    const now = () => new Date().toISOString();
    const send = (message: RpcMessage) => {
      if (!child.stdin || child.stdin.destroyed) return false;
      return child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const notifyError = (message: string) =>
      onEvent({ type: "error", data: message, timestamp: now() });
    const sessionRef = (): RuntimeSessionRef | undefined =>
      threadId
        ? {
            provider: this.id,
            sessionId: threadId,
            ...(turnId ? { turnId } : {}),
            transport: "app_server",
            authMode: runtime.authMode,
          }
        : undefined;
    const emitSession = () => {
      const ref = sessionRef();
      if (!ref) return;
      onEvent({
        type: "runtime_session",
        data: ref.sessionId,
        timestamp: now(),
        runtimeSession: ref,
      });
    };
    const request = (method: string, params: Record<string, unknown>) => {
      requestId += 1;
      send({ jsonrpc: "2.0", id: requestId, method, params } as RpcMessage);
      return requestId;
    };
    const turnInput = (text: string) => [{ type: "text", text }];
    const startTurn = (text: string) => {
      if (!threadId || turnActive) return false;
      turnActive = true;
      request("turn/start", {
        threadId,
        input: turnInput(text),
        ...(runtime.correlationId
          ? {
              clientUserMessageId: runtime.correlationId,
              responsesapiClientMetadata: {
                "ooda.correlation_id": runtime.correlationId,
              },
            }
          : {}),
      });
      return true;
    };
    const beginSession = () => {
      const approvalPolicy =
        runtime.permissionMode === "skip" ? "never" : "on-request";
      const common = {
        cwd: command.cwd,
        approvalPolicy,
        sandbox: "workspace-write",
        ...(runtime.systemPrompt
          ? { developerInstructions: runtime.systemPrompt }
          : {}),
        ...(runtime.model ? { model: runtime.model } : {}),
      };
      const nativeSession = runtime.session;
      if (nativeSession?.mode === "resume" && nativeSession.sessionId) {
        request("thread/resume", {
          ...common,
          threadId: nativeSession.sessionId,
        });
      } else if (nativeSession?.mode === "fork" && nativeSession.sessionId) {
        request("thread/fork", {
          ...common,
          threadId: nativeSession.sessionId,
          ephemeral: false,
        });
      } else {
        request("thread/start", { ...common, ephemeral: false });
      }
    };

    const respondPermission = (
      externalId: string,
      behavior: "allow" | "deny",
      message?: string,
    ): boolean => {
      const pending = approvals.get(externalId);
      if (!pending) return false;
      approvals.delete(externalId);
      const result = approvalResult(pending.method, behavior);
      if (result)
        return send({
          jsonrpc: "2.0",
          id: pending.rpcId,
          result,
        } as RpcMessage);
      return send({
        jsonrpc: "2.0",
        id: pending.rpcId,
        error: {
          code: -32_001,
          message:
            message ??
            (behavior === "allow"
              ? "Approval type requires structured input"
              : "Denied by OODA policy"),
        },
      } as RpcMessage);
    };

    const handle: AdapterProcessHandle = {
      write: (text) => {
        if (!threadId) return false;
        if (!turnActive) return startTurn(text);
        if (!turnId) return false;
        request("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          input: turnInput(text),
        });
        return true;
      },
      kill: () => {
        if (threadId && turnId && turnActive) {
          request("turn/interrupt", { threadId, turnId });
        }
        killProcessTree(child, "SIGTERM");
        killTimer ??= setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null)
            killProcessTree(child, "SIGKILL");
        }, KILL_GRACE_MS);
        killTimer.unref?.();
      },
      respondPermission,
    };
    options?.onSpawn?.(handle);
    const abort = () => handle.kill();
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();

    const handleMessage = (message: RpcMessage) => {
      if (message.error) {
        notifyError(message.error.message ?? "Codex app-server request failed");
        return;
      }

      if (message.id === 1 && message.result) {
        send({
          jsonrpc: "2.0",
          method: "initialized",
          params: {},
        } as RpcMessage);
        beginSession();
        return;
      }

      // thread/start, thread/resume, and thread/fork all return { thread }.
      if (message.id === 2 && message.result) {
        const thread = record(message.result.thread);
        threadId = stringValue(thread.id) ?? runtime.session?.sessionId;
        emitSession();
        if (command.prompt) startTurn(command.prompt);
        return;
      }

      if (message.method === "thread/started") {
        const thread = record(record(message.params).thread);
        threadId ??= stringValue(thread.id);
        emitSession();
        if (command.prompt) startTurn(command.prompt);
        return;
      }

      if (message.method === "turn/started") {
        const turn = record(record(message.params).turn);
        turnId = stringValue(turn.id);
        turnActive = true;
        emitSession();
        return;
      }

      if (message.method === "item/agentMessage/delta") {
        const delta = stringValue(record(message.params).delta);
        if (delta) {
          sawAssistantDelta = true;
          onEvent({ type: "stdout", data: delta, timestamp: now() });
        }
        return;
      }

      if (
        message.method === "item/reasoning/summaryTextDelta" ||
        message.method === "item/reasoning/textDelta"
      ) {
        const delta = stringValue(record(message.params).delta);
        if (delta)
          onEvent({
            type: "thought",
            data: delta,
            timestamp: now(),
            thought: { text: delta },
          });
        return;
      }

      if (message.method === "item/started") {
        const item = record(record(message.params).item);
        if (stringValue(item.type) === "agentMessage") return;
        const identity = toolIdentity(item);
        onEvent({
          type: "tool_call",
          data: identity.name,
          timestamp: now(),
          tool: {
            ...identity,
            status: "started",
            input: item,
          },
        });
        return;
      }

      if (message.method === "item/completed") {
        const item = record(record(message.params).item);
        if (stringValue(item.type) === "agentMessage") {
          const text = stringValue(item.text);
          if (text && !sawAssistantDelta)
            onEvent({ type: "stdout", data: text, timestamp: now() });
          return;
        }
        const identity = toolIdentity(item);
        onEvent({
          type: "tool_result",
          data: identity.name,
          timestamp: now(),
          tool: {
            ...identity,
            status: "completed",
            output: JSON.stringify(item),
          },
        });
        return;
      }

      if (message.method === "turn/completed") {
        const turn = record(record(message.params).turn);
        turnId = stringValue(turn.id) ?? turnId;
        turnActive = false;
        completed = stringValue(turn.status) === "completed";
        emitSession();
        return;
      }

      if (message.method && message.id !== undefined) {
        if (
          message.method === "item/commandExecution/requestApproval" ||
          message.method === "item/fileChange/requestApproval" ||
          message.method === "item/permissions/requestApproval" ||
          message.method === "item/tool/requestUserInput"
        ) {
          const externalId = `codex:${String(message.id)}`;
          approvals.set(externalId, {
            rpcId: message.id,
            method: message.method,
          });
          onEvent({
            type: "permission_request",
            data: message.method,
            timestamp: now(),
            permission: {
              requestId: externalId,
              toolName: message.method,
              input: message.params,
            },
          });
        }
      }
    };

    const scan = (chunk: string) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleMessage(JSON.parse(line) as RpcMessage);
        } catch (error) {
          notifyError(
            `Invalid Codex app-server event: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    };

    child.stdout?.on("data", (data: Buffer) => scan(data.toString()));
    child.stderr?.on("data", (data: Buffer) =>
      onEvent({ type: "stderr", data: data.toString(), timestamp: now() }),
    );

    return new Promise<AdapterExecutionResult>((resolve) => {
      let settled = false;
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        options?.signal?.removeEventListener("abort", abort);
        onEvent({
          type: "exit",
          data: "",
          timestamp: now(),
          exitCode,
          runtimeSession: sessionRef(),
        });
        resolve({
          exitCode,
          ...(sessionRef() ? { runtimeSession: sessionRef() } : {}),
        });
      };

      child.on("error", (error: Error) => {
        notifyError(error.message);
        finish(1);
      });
      child.on("close", (exitCode: number | null) =>
        finish(exitCode ?? (completed ? 0 : 1)),
      );

      const completionPoll = setInterval(() => {
        if (!completed) return;
        clearInterval(completionPoll);
        child.stdin?.end();
        killProcessTree(child, "SIGTERM");
        finish(0);
      }, 10);
      completionPoll.unref?.();

      request("initialize", {
        clientInfo: {
          name: "ooda-runner",
          title: "OODA Subscription Runtime",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      });
    });
  }
}
