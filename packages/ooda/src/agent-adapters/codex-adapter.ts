import { execSync, spawn } from "node:child_process";
import type {
  AgentAdapter,
  AdapterCommand,
  AdapterEvent,
  BuildCommandOptions,
} from "./types";

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

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    const args: string[] = ["exec"];

    if (opts.systemPrompt) {
      args.push("--instructions", opts.systemPrompt);
    }
    if (opts.model) {
      args.push("--model", opts.model);
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
