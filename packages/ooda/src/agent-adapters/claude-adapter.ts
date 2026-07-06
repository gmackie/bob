import { execSync, spawn } from "node:child_process";
import type {
  AgentAdapter,
  AdapterCommand,
  AdapterEvent,
  AdapterProcessHandle,
  BuildCommandOptions,
  ExecuteOptions,
} from "./types";

const KILL_GRACE_MS = 5_000;
// After a turn's `result`, wait this long for a follow-up user message before
// closing stdin (which ends the CLI session). Env-tunable for tests.
const STDIN_IDLE_CLOSE_MS = () =>
  Number(process.env.CLAUDE_STDIN_IDLE_CLOSE_MS ?? 3_000);

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

  buildCommand(opts: BuildCommandOptions): AdapterCommand {
    // The prompt travels over stdin as a stream-json user message (not argv),
    // which keeps stdin open for follow-up turns — this is what lets a user
    // steer a running session. `execute` closes stdin once every queued turn
    // has produced its result, so single-prompt runs exit exactly as before.
    const args: string[] = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (opts.systemPrompt) {
      args.push("--append-system-prompt", opts.systemPrompt);
    }
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.allowedTools?.length) {
      args.push("--allowedTools", opts.allowedTools.join(","));
    }

    return {
      binary: "claude",
      args,
      cwd: opts.workspaceRoot,
      prompt: opts.prompt,
    };
  }

  async execute(
    command: AdapterCommand,
    onEvent: (event: AdapterEvent) => void,
    options?: ExecuteOptions,
  ): Promise<{ exitCode: number }> {
    // Legacy callers may pass a command with the prompt baked into args and
    // no `prompt` field — run those exactly as before (no stdin).
    const interactive = command.prompt !== undefined;

    const child = spawn(command.binary, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: [interactive ? "pipe" : "ignore", "pipe", "pipe"] as const,
    });

    // Session lifetime: after each turn's `result` line, arm a short idle
    // timer; if no follow-up user message is written before it fires, close
    // stdin so the CLI exits. This is robust to both observed CLI behaviors —
    // a message written mid-turn may be MERGED into the current turn (one
    // result for two writes) or queued as a new turn (a result each) — since
    // we never count turns, we just watch for post-result quiet.
    let stdinOpen = interactive;
    let killed = false;
    let idleCloseTimer: NodeJS.Timeout | null = null;

    const closeStdin = () => {
      if (!stdinOpen) return;
      stdinOpen = false;
      if (idleCloseTimer) {
        clearTimeout(idleCloseTimer);
        idleCloseTimer = null;
      }
      child.stdin?.end();
    };

    const armIdleClose = () => {
      if (!stdinOpen) return;
      if (idleCloseTimer) clearTimeout(idleCloseTimer);
      idleCloseTimer = setTimeout(closeStdin, STDIN_IDLE_CLOSE_MS());
      idleCloseTimer.unref?.();
    };

    const writeUserMessage = (text: string): boolean => {
      if (!stdinOpen || !child.stdin || child.stdin.destroyed) return false;
      // A new message cancels any pending close — it either joins the current
      // turn or starts the next one; the next `result` re-arms the timer.
      if (idleCloseTimer) {
        clearTimeout(idleCloseTimer);
        idleCloseTimer = null;
      }
      child.stdin.write(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: text },
        }) + "\n",
      );
      return true;
    };

    const handle: AdapterProcessHandle = {
      write: (text) => writeUserMessage(text),
      kill: () => {
        killed = true;
        closeStdin();
        child.kill("SIGTERM");
        const escalate = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, KILL_GRACE_MS);
        escalate.unref?.();
      },
    };

    if (interactive && command.prompt) {
      writeUserMessage(command.prompt);
    }
    options?.onSpawn?.(handle);

    // Line-buffer stdout to spot `{"type":"result",...}` turn boundaries;
    // chunks are still forwarded raw so consumers see the same stream.
    let lineBuffer = "";
    const scanForResults = (chunk: string) => {
      lineBuffer += chunk;
      let idx: number;
      while ((idx = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, idx).trim();
        lineBuffer = lineBuffer.slice(idx + 1);
        if (!line.startsWith("{") || !line.includes('"type":"result"')) continue;
        try {
          if ((JSON.parse(line) as { type?: string }).type !== "result") continue;
        } catch {
          continue;
        }
        armIdleClose();
      }
    };

    return new Promise((resolve) => {
      let settled = false;
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode });
      };

      child.stdin?.on("error", () => {
        // EPIPE if the CLI exits while we hold stdin open — not fatal.
        stdinOpen = false;
      });

      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (interactive) scanForResults(text);
        onEvent({
          type: "stdout",
          data: text,
          timestamp: new Date().toISOString(),
        });
      });

      child.stderr?.on("data", (data: Buffer) => {
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
        const resolvedExitCode = killed ? 130 : exitCode ?? 1;
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
