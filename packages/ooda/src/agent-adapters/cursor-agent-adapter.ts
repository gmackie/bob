import { execSync, spawn } from "node:child_process";
import type { AgentAdapter, AdapterCommand, AdapterEvent } from "./types";

export class CursorAgentAdapter implements AgentAdapter {
  id = "cursor-agent" as const;
  name = "Cursor Agent" as const;
  transport = "stdio" as const;

  isAvailable(): boolean {
    if (process.env.CURSOR_API_KEY) return true;
    try {
      execSync("which cursor-agent", { stdio: "ignore" });
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
    const args: string[] = ["--print", "--output-format", "stream-json", "--force"];
    const prompt = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n${opts.prompt}`
      : opts.prompt;

    args.push(prompt);

    return {
      binary: "cursor-agent",
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
