import { execSync, spawn } from "node:child_process";
import type { AgentAdapter, AdapterCommand, AdapterEvent } from "./types";

export class ClaudeAdapter implements AgentAdapter {
  id = "claude" as const;
  name = "Claude Code" as const;
  transport = "api" as const;

  isAvailable(): boolean {
    // Check env var OR if the binary exists (it manages its own auth)
    if (process.env.ANTHROPIC_API_KEY) return true;
    try {
      execSync("which claude", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand {
    const args: string[] = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (opts.systemPrompt) {
      args.push("--append-system-prompt", opts.systemPrompt);
    }

    args.push(opts.prompt);

    return {
      binary: "claude",
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
