import { execSync } from "node:child_process";
import type { AgentAdapter, AdapterCommand, AdapterEvent } from "./types";

export class CodexAdapter implements AgentAdapter {
  id = "codex" as const;
  name = "Codex CLI" as const;
  transport = "stdio" as const;

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

  buildCommand(opts: {
    prompt: string;
    workspaceRoot: string;
    systemPrompt?: string;
  }): AdapterCommand {
    const args: string[] = ["exec"];

    if (opts.systemPrompt) {
      args.push("--instructions", opts.systemPrompt);
    }

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
    const { spawn } = await import("node-pty");

    const pty = spawn(command.binary, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env } as Record<string, string>,
      cols: 120,
      rows: 40,
    });

    return new Promise((resolve) => {
      pty.onData((data: string) => {
        onEvent({
          type: "stdout",
          data,
          timestamp: new Date().toISOString(),
        });
      });

      pty.onExit(({ exitCode }: { exitCode: number }) => {
        onEvent({
          type: "exit",
          data: "",
          timestamp: new Date().toISOString(),
          exitCode,
        });
        resolve({ exitCode });
      });
    });
  }
}
