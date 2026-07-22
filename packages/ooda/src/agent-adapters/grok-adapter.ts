import { execSync, spawn } from "node:child_process";

import { AcpClient } from "./acp-client";
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
  McpServerConfigLike,
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
    const args = [
      "--cwd",
      opts.workspaceRoot,
      "agent",
      "--always-approve",
      "stdio",
    ];

    const command: AdapterCommand = {
      binary: "grok",
      args,
      cwd: opts.workspaceRoot,
      prompt: opts.prompt,
    };

    if (process.env.XAI_API_KEY) {
      command.env = { XAI_API_KEY: process.env.XAI_API_KEY };
    }

    return command;
  }

  async execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }> {
    const child = spawn(command.binary, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ["pipe", "pipe", "pipe"] as const,
    });

    const client = new AcpClient({
      write: (data) => child.stdin.write(data),
      onNotification: (method, params) => {
        if (method !== "session/update") return;
        const update = (params as { update?: SessionUpdate } | undefined)?.update;
        if (!update) return;
        const event = mapSessionUpdate(update);
        if (event) onEvent(event);
      },
      onRequest: (method, params) =>
        handleAgentRequest(command.cwd, method, params, this.toolDescriptors),
    });

    child.stdout.on("data", (data: Buffer) => client.feed(data.toString()));

    child.stderr.on("data", (data: Buffer) => {
      onEvent({ type: "stderr", data: data.toString(), timestamp: new Date().toISOString() });
    });

    // Surface a hard spawn failure (e.g. `grok` not on PATH) and unblock the session.
    child.on("error", (error: Error) => {
      onEvent({ type: "error", data: error.message, timestamp: new Date().toISOString() });
      client.rejectAll(error);
    });

    let exitCode = 0;
    try {
      const result = await runGrokAcpSession({
        client,
        prompt: command.prompt ?? "",
        cwd: command.cwd,
        apiKeyPresent: Boolean(process.env.XAI_API_KEY),
        mcpServers: this.mcpServers,
      });
      exitCode = result.exitCode;
    } catch (error) {
      onEvent({
        type: "error",
        data: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
      exitCode = 1;
      // A timeout/protocol error means the agent is wedged — terminate it
      // rather than leaking the process. SIGTERM, then SIGKILL as backstop.
      if (!child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5000).unref();
      }
    } finally {
      child.stdin.end();
    }

    onEvent({ type: "exit", data: "", timestamp: new Date().toISOString(), exitCode });
    return { exitCode };
  }
}
