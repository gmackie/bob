import { spawn, type ChildProcess } from "child_process";
import type { SessionActor } from "../sessions/SessionActor.js";
import { getStdioAdapter, type StdioAdapter } from "./adapters/base-stdio-adapter.js";
import { spawnClaudePty, isPtyAvailable, type ClaudePtySession } from "./adapters/claude-pty.js";

interface ManagedSession {
  process: ChildProcess;
  adapter: StdioAdapter;
  actor: SessionActor;
  agentType: string;
  claudeSessionId?: string;
  ptySession?: ClaudePtySession; // PTY-based session for Claude interactive mode
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
  private starting = new Set<string>(); // Prevents concurrent starts for the same session

  async startSession(config: StartSessionConfig): Promise<void> {
    const { sessionId, agentType, workingDirectory, initialPrompt, actor } = config;

    // Prevent concurrent starts
    if (this.starting.has(sessionId)) {
      console.log(`[AgentProcessManager] Session ${sessionId} already starting, skipping duplicate`);
      return;
    }
    this.starting.add(sessionId);

    try {
      await this._doStartSession(config);
    } finally {
      this.starting.delete(sessionId);
    }
  }

  private async _doStartSession(config: StartSessionConfig): Promise<void> {
    const { sessionId, agentType, workingDirectory, initialPrompt, actor } = config;

    if (this.sessions.has(sessionId)) {
      // Don't kill an existing working session — just skip
      console.log(`[AgentProcessManager] Session ${sessionId} already managed, skipping`);
      return;
    }

    const adapter = getStdioAdapter(agentType, workingDirectory);
    if (!adapter) {
      throw new Error(`No stdio adapter available for agent type: ${agentType}`);
    }

    // For Claude: try PTY mode first (enables multi-turn tool use)
    const ptyOk = isPtyAvailable();
    console.log(`[AgentProcessManager] agentType=${agentType}, isPtyAvailable=${ptyOk}`);
    if (agentType === "claude" && ptyOk) {
      try {
        await this.startClaudePtySession(sessionId, workingDirectory, adapter, actor, initialPrompt);
        return;
      } catch (err) {
        console.warn(`[AgentProcessManager] PTY spawn failed for ${sessionId}, falling back to stdio:`, err);
      }
    }

    // Fallback: stdio mode (sentinel process for Claude, direct for others)
    const env = {
      ...process.env,
      ...adapter.env,
    };

    console.log(
      `[AgentProcessManager] Spawning ${adapter.command} ${adapter.args.join(" ")} for session ${sessionId} (stdio mode)`,
    );

    const child = spawn(adapter.command, adapter.args, {
      cwd: workingDirectory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const managed: ManagedSession = { process: child, adapter, actor, agentType };
    this.sessions.set(sessionId, managed);

    actor.setStatus("starting");

    let stdoutBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleLine(sessionId, line);
      }
    });

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
      console.log(`[AgentProcessManager] Process exited for session ${sessionId}: code=${code} signal=${signal}`);
      if (agentType === "claude") {
        console.log(`[AgentProcessManager] Claude sentinel exited, session stays managed`);
        return;
      }
      actor.handleAgentExit(code, signal);
      this.sessions.delete(sessionId);
    });

    actor.setStatus("running");

    if (initialPrompt && child.stdin?.writable) {
      const formatted = adapter.formatInput(initialPrompt);
      child.stdin.write(formatted);
    }
  }

  /**
   * Start Claude in a real PTY for interactive multi-turn sessions.
   * Claude gets a real terminal so it stays in interactive mode with full tool use.
   */
  private async startClaudePtySession(
    sessionId: string,
    workingDirectory: string,
    adapter: StdioAdapter,
    actor: SessionActor,
    initialPrompt?: string,
  ): Promise<void> {
    console.log(`[AgentProcessManager] Starting Claude PTY session for ${sessionId} in ${workingDirectory}`);

    const ptySession = await spawnClaudePty(workingDirectory, adapter.env as Record<string, string>);

    // Create a dummy child process reference for the ManagedSession interface
    const dummyChild = spawn("true", [], { stdio: "ignore" });

    const managed: ManagedSession = {
      process: dummyChild,
      adapter,
      actor,
      agentType: "claude",
      ptySession,
    };
    this.sessions.set(sessionId, managed);

    actor.setStatus("starting");

    // Buffer and parse PTY output line by line
    let buffer = "";
    ptySession.onData((data: string) => {
      buffer += data;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Strip ANSI escape codes for cleaner parsing
        const clean = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
        if (!clean) continue;

        this.handleLine(sessionId, clean);
      }
    });

    ptySession.pty.onExit(({ exitCode, signal }) => {
      console.log(`[AgentProcessManager] Claude PTY exited for ${sessionId}: code=${exitCode} signal=${signal}`);
      actor.handleAgentExit(exitCode, signal);
      this.sessions.delete(sessionId);
    });

    actor.setStatus("running");

    // Auto-accept workspace trust dialog
    // The dialog shows option "1. Yes, I trust this folder" pre-selected with ❯
    // Just press Enter to confirm the default selection
    setTimeout(() => {
      ptySession.write("\r");
      console.log(`[AgentProcessManager] Sent trust dialog acceptance (Enter) for ${sessionId}`);
    }, 2000);

    // Send initial prompt after Claude finishes loading
    if (initialPrompt) {
      setTimeout(() => {
        ptySession.write(initialPrompt + "\n");
      }, 8000); // Wait for trust dialog + hook loading
    }

    console.log(`[AgentProcessManager] Claude PTY session ${sessionId} started (PID=${ptySession.pty.pid})`);
  }

  sendInput(sessionId: string, message: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;

    const { adapter, actor, agentType, ptySession } = managed;

    // If we have a PTY session (Claude interactive mode), write directly to it
    if (ptySession) {
      console.log(`[AgentProcessManager] Sending to Claude PTY for session ${sessionId}`);
      ptySession.write(message + "\n");
      return true;
    }

    // For Claude in non-TTY: spawn a new -p process per message
    // because piped stdin triggers print mode (one-shot)
    if (agentType === "claude") {
      const args = ["-p", "--output-format", "stream-json", "--verbose"];

      // Use --resume to continue conversation if we have a Claude session ID
      if (managed.claudeSessionId) {
        args.push("--resume", managed.claudeSessionId);
        console.log(`[AgentProcessManager] Spawning Claude --resume ${managed.claudeSessionId} for session ${sessionId}`);
      } else {
        console.log(`[AgentProcessManager] Spawning new Claude conversation for session ${sessionId}`);
      }

      const child = spawn("claude", args, {
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

          // Capture Claude session ID from init event for conversation continuity
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
              managed.claudeSessionId = parsed.session_id;
              console.log(`[AgentProcessManager] Captured Claude session ID: ${parsed.session_id}`);
            }
          } catch { /* not JSON */ }

          this.handleLine(sessionId, line);
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
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

    // Kill PTY session if it exists
    if (managed.ptySession) {
      console.log(`[AgentProcessManager] Killing Claude PTY for session ${sessionId}`);
      managed.ptySession.kill();
      this.sessions.delete(sessionId);
      return;
    }

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
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;

    // Check if the PTY/process is actually alive
    if (managed.ptySession) {
      // PTY session — check if process is still running
      try {
        process.kill(managed.ptySession.pty.pid, 0); // Signal 0 = check if alive
        return true;
      } catch {
        // Process is dead — clean up
        console.log(`[AgentProcessManager] PTY for ${sessionId} is dead, cleaning up`);
        this.sessions.delete(sessionId);
        return false;
      }
    }

    return true; // stdio-managed sessions are always considered alive (sentinel pattern)
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
      // Null means the adapter intentionally skipped this line (system events, etc.)
      // Only output truly unparseable lines (not JSON)
      try {
        JSON.parse(line); // If it parses as JSON, it was intentionally skipped
      } catch {
        // Not JSON — treat as raw text output (e.g., warnings, errors)
        actor.handleAgentOutput(line + "\n");
      }
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
