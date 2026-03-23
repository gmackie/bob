import { spawn, type ChildProcess } from "child_process";
import type { SessionActor } from "../sessions/SessionActor.js";
import { getStdioAdapter, type StdioAdapter } from "./adapters/base-stdio-adapter.js";

interface ManagedSession {
  process: ChildProcess;
  adapter: StdioAdapter;
  actor: SessionActor;
  agentType: string;
}

interface StartSessionConfig {
  sessionId: string;
  agentType: string;
  workingDirectory: string;
  initialPrompt?: string;
  actor: SessionActor;
}

export class AgentProcessManager {
  private sessions = new Map<string, ManagedSession>();

  async startSession(config: StartSessionConfig): Promise<void> {
    const { sessionId, agentType, workingDirectory, initialPrompt, actor } = config;

    if (this.sessions.has(sessionId)) {
      console.warn(`[AgentProcessManager] Session ${sessionId} already managed, stopping existing`);
      await this.stopSession(sessionId);
    }

    const adapter = getStdioAdapter(agentType, workingDirectory);
    if (!adapter) {
      throw new Error(`No stdio adapter available for agent type: ${agentType}`);
    }

    const env = {
      ...process.env,
      ...adapter.env,
    };

    console.log(
      `[AgentProcessManager] Spawning ${adapter.command} ${adapter.args.join(" ")} for session ${sessionId}`,
    );

    const child = spawn(adapter.command, adapter.args, {
      cwd: workingDirectory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const managed: ManagedSession = { process: child, adapter, actor, agentType };
    this.sessions.set(sessionId, managed);

    actor.setStatus("starting");

    // Buffer partial lines from stdout
    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      // Keep the last incomplete line in the buffer
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleLine(sessionId, line);
      }
    });

    // Capture stderr as output
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      console.error(`[AgentProcessManager] stderr (${sessionId}): ${text.slice(0, 500)}`);
      actor.handleAgentOutput(text, "stderr");
    });

    child.on("error", (error) => {
      console.error(`[AgentProcessManager] Process error for session ${sessionId}:`, error);
      actor.setStatus("error", String(error));
      this.sessions.delete(sessionId);
    });

    child.on("exit", (code, signal) => {
      console.log(
        `[AgentProcessManager] Process exited for session ${sessionId}: code=${code} signal=${signal}`,
      );
      // For Claude: the sentinel process exits immediately — don't tear down the session
      // (Claude uses per-message spawning because piped stdin triggers print mode)
      if (agentType === "claude") {
        console.log(`[AgentProcessManager] Claude sentinel exited, session stays managed for per-message spawning`);
        return;
      }
      actor.handleAgentExit(code, signal);
      this.sessions.delete(sessionId);
    });

    // Mark as running once the process is spawned
    actor.setStatus("running");

    // Send the initial prompt if provided
    if (initialPrompt && child.stdin?.writable) {
      const formatted = adapter.formatInput(initialPrompt);
      child.stdin.write(formatted);
    }
  }

  sendInput(sessionId: string, message: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;

    const { adapter, actor, agentType } = managed;

    // For Claude in non-TTY: spawn a new -p process per message
    // because piped stdin triggers print mode (one-shot)
    if (agentType === "claude") {
      console.log(`[AgentProcessManager] Spawning per-message Claude for session ${sessionId}`);
      const child = spawn("claude", ["-p", "--output-format", "stream-json", "--verbose"], {
        cwd: managed.process.spawnargs ? undefined : "/",
        env: { ...process.env, ...adapter.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          this.handleLine(sessionId, line);
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        // Skip warnings about stdin timing
        if (text.includes("no stdin data received")) return;
        console.error(`[AgentProcessManager] per-msg stderr (${sessionId}): ${text.slice(0, 200)}`);
      });

      child.on("exit", (code) => {
        console.log(`[AgentProcessManager] Per-message Claude exited: code=${code}`);
      });

      // Write the message to stdin immediately
      child.stdin?.write(message);
      child.stdin?.end();
      return true;
    }

    // Default: write to existing process stdin
    const { process: child } = managed;
    if (!child.stdin?.writable) {
      console.warn(`[AgentProcessManager] stdin not writable for session ${sessionId}`);
      return false;
    }

    const formatted = adapter.formatInput(message);
    child.stdin.write(formatted);
    return true;
  }

  async stopSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    const { process: child } = managed;

    // Send SIGTERM and wait for graceful exit
    child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if still running after 5 seconds
        if (!child.killed) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      child.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.sessions.delete(sessionId);
  }

  isManaging(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getStatus(sessionId: string): "running" | "not_found" {
    return this.sessions.has(sessionId) ? "running" : "not_found";
  }

  private handleLine(sessionId: string, line: string): void {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    const { adapter, actor } = managed;
    const event = adapter.parseLine(line);

    if (!event) {
      // Unparseable line — treat as raw output
      actor.handleAgentOutput(line + "\n");
      return;
    }

    switch (event.type) {
      case "output":
        actor.handleAgentOutput((event.data.text as string) ?? "");
        break;

      case "tool_call":
        actor.handleToolCall(
          event.data.toolCallId as string,
          event.data.name as string,
          (event.data.arguments as string) ?? "{}",
        );
        break;

      case "tool_result":
        actor.handleToolResult(
          event.data.toolCallId as string,
          (event.data.result as string) ?? "",
          (event.data.isError as boolean) ?? false,
        );
        break;

      case "status":
        // Status events are informational — log them
        console.log(`[AgentProcessManager] Status for session ${sessionId}:`, event.data);
        break;

      case "error":
        actor.handleAgentOutput(`Error: ${event.data.message ?? "Unknown error"}\n`, "stderr");
        break;
    }
  }

  destroy(): void {
    for (const [sessionId] of this.sessions) {
      this.stopSession(sessionId).catch((err) =>
        console.error(`[AgentProcessManager] Error stopping session ${sessionId}:`, err),
      );
    }
  }
}
