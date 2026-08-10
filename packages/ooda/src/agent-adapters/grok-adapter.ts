import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { AcpClient } from "./acp-client";
import { killProcessTree, spawnAdapterProcess } from "./process-tree";
import {
  handleAgentRequest,
  mapSessionUpdate,
  runGrokAcpSession,
  type SessionUpdate,
} from "./grok-acp";
import type { ToolDescriptor } from "./tool-registry";
import type {
  AgentAdapter,
  AdapterCommand,
  AdapterEvent,
  BuildCommandOptions,
  ExecuteOptions,
  McpServerConfigLike,
  RuntimeCapabilities,
  RuntimeSessionRef,
} from "./types";

/**
 * Grok Build adapter — drives xAI's `grok` coding agent over ACP
 * (Agent Client Protocol), a JSON-RPC 2.0 conversation on the agent's
 * stdin/stdout (`grok agent stdio`).
 *
 * Unlike the CLI-spawn adapters, the prompt is delivered over the
 * protocol (`session/prompt`), not as an argv entry — so `buildCommand`
 * stashes it on `AdapterCommand.prompt`.
 */
export class GrokAdapter implements AgentAdapter {
  id = "grok" as const;
  name = "Grok Build" as const;
  transport = "stdio" as const;

  /**
   * Buddy-tool descriptors exposed to the agent for the next `execute`.
   * Stashed by `registerTools` (called via the tool-registry helper at
   * session start) and threaded into the ACP request handler so the agent
   * can actually invoke them mid-session.
   */
  private toolDescriptors: readonly ToolDescriptor[] = [];

  /**
   * MCP servers advertised to the agent on the next `session/new`. Grok
   * connects OUT to these and calls their tools mid-session — the live
   * buddy-tool path. Stashed by `registerMcpServers` (called by the session
   * executor after it stands up the in-process MCP server for this session).
   */
  private mcpServers: readonly McpServerConfigLike[] = [];

  registerTools(tools: ToolDescriptor[]): void {
    this.toolDescriptors = tools;
  }

  registerMcpServers(servers: McpServerConfigLike[]): void {
    this.mcpServers = servers;
  }

  capabilities(): RuntimeCapabilities {
    return {
      transport: "acp",
      supportsResume: true,
      supportsFork: false,
      supportsSteering: true,
      supportsApprovals: true,
      supportsUsageInspection: false,
      authModes: ["subscription", "api_key"],
    };
  }

  isAvailable(): boolean {
    if (process.env.XAI_API_KEY) return true;
    try {
      execSync("which grok", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    // grok CLI grammar: top-level opts -> `agent` -> agent opts -> `stdio`.
    // `--cwd` is top-level; `--always-approve` is an `agent` option; the
    // `agent stdio` subcommand takes no flags of its own. (Verified against
    // grok 0.2.16 — see apps/ooda-runner/scripts/grok-acp-smoke.mjs.)
    const args = ["--cwd", opts.workspaceRoot, "agent"];
    if ((opts.permissionMode ?? "prompt") === "skip")
      args.push("--always-approve");
    if (opts.model) args.push("--model", opts.model);
    args.push("stdio");

    const command: AdapterCommand = {
      binary: "grok",
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
          (process.env.XAI_API_KEY ? "api_key" : "subscription"),
        correlationId: opts.correlationId,
      },
    };

    if (process.env.XAI_API_KEY) {
      command.env = { XAI_API_KEY: process.env.XAI_API_KEY };
    }

    return command;
  }

  async execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }> {
    const childEnvironment = {
      ...(options?.environment ?? process.env),
      ...command.env,
    };
    if (command.runtime?.authMode === "subscription")
      delete childEnvironment.XAI_API_KEY;
    const child = spawnAdapterProcess(command.binary, command.args, {
      cwd: command.cwd,
      env: childEnvironment as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"] as const,
    });

    let killTimer: NodeJS.Timeout | undefined;
    const pendingPermissions = new Map<
      string,
      {
        options: Array<{ optionId?: string; kind?: string }>;
        resolve: (result: unknown) => void;
      }
    >();
    const resolvePermission = (
      requestId: string,
      behavior: "allow" | "deny",
    ): boolean => {
      const pending = pendingPermissions.get(requestId);
      if (!pending) return false;
      pendingPermissions.delete(requestId);
      const desiredPrefix = behavior === "allow" ? "allow" : "reject";
      const selected =
        pending.options.find((option) =>
          option.kind?.startsWith(desiredPrefix),
        ) ??
        pending.options.find((option) =>
          behavior === "deny" ? option.kind?.startsWith("deny") : false,
        ) ??
        pending.options[0];
      pending.resolve({
        outcome: {
          outcome: "selected",
          ...(selected?.optionId ? { optionId: selected.optionId } : {}),
        },
      });
      return true;
    };
    const handle = {
      write: (text: string) => child.stdin!.write(text),
      kill: () => {
        killProcessTree(child, "SIGTERM");
        killTimer ??= setTimeout(() => {
          if (child.exitCode === null) killProcessTree(child, "SIGKILL");
        }, 5_000);
        killTimer.unref?.();
      },
      respondPermission: (requestId: string, behavior: "allow" | "deny") =>
        resolvePermission(requestId, behavior),
    };
    options?.onSpawn?.(handle);
    const abort = () => handle.kill();
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();

    const client = new AcpClient({
      write: (data) => child.stdin!.write(data),
      onNotification: (method, params) => {
        if (method !== "session/update") return;
        const update = (params as { update?: SessionUpdate } | undefined)
          ?.update;
        if (!update) return;
        const event = mapSessionUpdate(update);
        if (event) onEvent(event);
      },
      onRequest: (method, params) => {
        if (
          method === "session/request_permission" &&
          command.runtime?.permissionMode !== "skip"
        ) {
          const requestId = `grok:${randomUUID()}`;
          const permission = params as {
            options?: Array<{ optionId?: string; kind?: string }>;
            toolCall?: unknown;
          };
          onEvent({
            type: "permission_request",
            data: "Grok tool execution requires approval",
            timestamp: new Date().toISOString(),
            permission: {
              requestId,
              toolName: "grok_tool",
              input: permission.toolCall ?? params,
            },
          });
          return new Promise((resolve) => {
            pendingPermissions.set(requestId, {
              options: permission.options ?? [],
              resolve,
            });
          });
        }
        return handleAgentRequest(
          command.cwd,
          method,
          params,
          this.toolDescriptors,
        );
      },
    });

    child.once("close", (code, signal) => {
      client.rejectAll(
        new Error(
          `Grok ACP process closed before pending requests completed (code ${code ?? "null"}, signal ${signal ?? "none"})`,
        ),
      );
    });

    child.stdout!.on("data", (data: Buffer) => client.feed(data.toString()));

    child.stderr!.on("data", (data: Buffer) => {
      onEvent({
        type: "stderr",
        data: data.toString(),
        timestamp: new Date().toISOString(),
      });
    });

    // Surface a hard spawn failure (e.g. `grok` not on PATH) and unblock the session.
    child.on("error", (error: Error) => {
      onEvent({
        type: "error",
        data: error.message,
        timestamp: new Date().toISOString(),
      });
      client.rejectAll(error);
    });

    let exitCode = 0;
    let nativeSessionId: string | undefined;
    try {
      const result = await runGrokAcpSession({
        client,
        prompt: command.prompt ?? "",
        cwd: command.cwd,
        apiKeyPresent:
          command.runtime?.authMode === "api_key" &&
          Boolean(childEnvironment.XAI_API_KEY),
        mcpServers: this.mcpServers,
        systemPrompt: command.runtime?.systemPrompt,
        existingSessionId:
          command.runtime?.session?.mode === "resume"
            ? command.runtime.session.sessionId
            : undefined,
      });
      exitCode = result.exitCode;
      nativeSessionId = result.sessionId;
      if (result.sessionId) {
        const runtimeSession: RuntimeSessionRef = {
          provider: this.id,
          sessionId: result.sessionId,
          transport: "acp",
          authMode: command.runtime?.authMode ?? "subscription",
        };
        onEvent({
          type: "runtime_session",
          data: runtimeSession.sessionId,
          timestamp: new Date().toISOString(),
          runtimeSession,
        });
      }
    } catch (error) {
      onEvent({
        type: "error",
        data: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      exitCode = 1;
      // A timeout/protocol error means the agent is wedged — terminate it
      // rather than leaking the process. SIGTERM, then SIGKILL as backstop.
      handle.kill();
    } finally {
      child.stdin!.end();
    }

    onEvent({
      type: "exit",
      data: "",
      timestamp: new Date().toISOString(),
      exitCode,
    });
    options?.signal?.removeEventListener("abort", abort);
    if (killTimer) clearTimeout(killTimer);
    return {
      exitCode,
      ...(nativeSessionId
        ? {
            runtimeSession: {
              provider: this.id,
              sessionId: nativeSessionId,
              transport: "acp" as const,
              authMode: command.runtime?.authMode ?? "subscription",
            },
          }
        : {}),
    };
  }
}
