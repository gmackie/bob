import { execSync, spawn } from "node:child_process";

import { buildCodexMcpConfigArgs } from "./mcp-config";
import type {
  AgentAdapter,
  AdapterCommand,
  AdapterEvent,
  BuildCommandOptions,
  McpServerConfigLike,
} from "./types";

export class CodexAdapter implements AgentAdapter {
  id = "codex" as const;
  name = "Codex CLI" as const;
  transport = "stdio" as const;

  /**
   * MCP servers advertised to codex on the next `execute`. Stashed by
   * `registerMcpServers` (called by the session executor after it stands up
   * the in-process buddy-tool MCP server) and consumed in `buildCommand` as
   * `-c mcp_servers.<name>.url=...` config overrides — codex 0.135 registers
   * streamable-HTTP MCP servers that way (`codex mcp add --url`).
   */
  private mcpServers: readonly McpServerConfigLike[] = [];

  registerMcpServers(servers: McpServerConfigLike[]): void {
    this.mcpServers = servers;
  }

  isAvailable(): boolean {
    // Check env var OR if the binary exists (it manages its own auth)
    if (process.env.OPENAI_API_KEY) return true;
    try {
      execSync("which codex", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    const args: string[] = ["exec"];

    if (opts.systemPrompt) {
      args.push("--instructions", opts.systemPrompt);
    }
    if (opts.model) {
      args.push("--model", opts.model);
    }

    // Buddy-tool MCP servers registered by the session executor for this
    // session: register each as a streamable-HTTP server via `-c` config
    // overrides (empty when none, so codex's default behavior is unchanged).
    args.push(...buildCodexMcpConfigArgs(this.mcpServers));

    // Positional prompt must come last, after all flags/overrides.
    args.push(opts.prompt);

    return {
      binary: "codex",
      args,
      cwd: opts.workspaceRoot,
    };
  }

  async execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
  ): Promise<{ exitCode: number }> {
    const child = spawn(command.binary, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ["ignore", "pipe", "pipe"] as const,
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode });
      };

      child.stdout.on("data", (data: Buffer) => {
        onEvent({
          type: "stdout",
          data: data.toString(),
          timestamp: new Date().toISOString(),
        });
      });

      child.stderr.on("data", (data: Buffer) => {
        onEvent({
          type: "stderr",
          data: data.toString(),
          timestamp: new Date().toISOString(),
        });
      });

      child.on("error", (error: Error) => {
        onEvent({
          type: "error",
          data: error.message,
          timestamp: new Date().toISOString(),
        });
        finish(1);
      });

      child.on("close", (exitCode: number | null) => {
        const resolvedExitCode = exitCode ?? 1;
        onEvent({
          type: "exit",
          data: "",
          timestamp: new Date().toISOString(),
          exitCode: resolvedExitCode,
        });
        finish(resolvedExitCode);
      });
    });
  }
}
