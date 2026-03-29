import { spawn, type ChildProcess } from "child_process";
import type { SessionActor } from "../sessions/SessionActor.js";
import { getStdioAdapter, type StdioAdapter } from "./adapters/base-stdio-adapter.js";
import { spawnClaudePty, isPtyAvailable, type ClaudePtySession } from "./adapters/claude-pty.js";
import { db } from "@bob/db/client";
import { eq } from "@bob/db";
import { runLifecycleEvents, taskRuns, chatConversations } from "@bob/db/schema";
import { isCookieToolCall, handleCookieToolCall } from "../sessions/cookieToolHandler.js";

/** Regex patterns that suggest an agent result produced a real artifact. */
const ARTIFACT_PATTERNS = [
  /\/home\/|\/tmp\/|\/Volumes\//, // absolute file paths
  /file:\/\//,                    // file URLs
  /#\d+/,                         // PR numbers
  /[0-9a-f]{7,40}/,               // commit SHAs
];

function looksLikeArtifact(result: string): boolean {
  return ARTIFACT_PATTERNS.some((p) => p.test(result));
}

interface ManagedSession {
  process: ChildProcess;
  adapter: StdioAdapter;
  actor: SessionActor;
  agentType: string;
  claudeSessionId?: string;
  ptySession?: ClaudePtySession; // PTY-based session for Claude interactive mode
  /** Tracks active delegation tool calls so we can pair start/end events. */
  activeDelegations?: Map<string, { toolName: string; startedAt: number }>;
}

interface StartSessionConfig {
  sessionId: string;
  agentType: string;
  workingDirectory: string;
  initialPrompt?: string;
  env?: Record<string, string>;
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

    // PTY mode disabled — per-message spawn with --resume is more reliable
    // PTY has trust dialog issues that require manual acceptance
    // TODO: Re-enable PTY when Claude CLI supports --skip-trust-dialog

    // Fallback: stdio mode (sentinel process for Claude, direct for others)
    const env = {
      ...process.env,
      ...adapter.env,
      ...config.env,
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

      // Cascade fallback: if agent spawn failed (ENOENT), try next agent
      const isSpawnError = (error as NodeJS.ErrnoException).code === "ENOENT";
      if (isSpawnError && agentType !== "claude") {
        const agentDisplayName: Record<string, string> = {
          "smol-agent": "Smol Agent",
          claude: "Claude",
          codex: "Codex",
          gemini: "Gemini",
        };
        const fallbackChain = ["claude", "codex", "gemini"].filter((a) => a !== agentType);
        console.warn(
          `[AgentProcessManager] ${agentType} not found, trying fallback chain: ${fallbackChain.join(" → ")}`,
        );
        this.sessions.delete(sessionId);

        actor.handleAgentOutput(
          `${agentDisplayName[agentType] ?? agentType} is not available on this host. Finding an alternative...\n`,
        );

        // Try each fallback agent
        void (async () => {
          for (const fallbackAgent of fallbackChain) {
            try {
              const fallbackAdapter = getStdioAdapter(fallbackAgent, workingDirectory);
              if (!fallbackAdapter) continue;

              console.log(`[AgentProcessManager] Trying fallback agent: ${fallbackAgent}`);
              await this.startSession({
                ...config,
                agentType: fallbackAgent,
              });
              console.log(`[AgentProcessManager] Fallback to ${fallbackAgent} succeeded for session ${sessionId}`);

              actor.handleAgentOutput(
                `Connected to **${agentDisplayName[fallbackAgent] ?? fallbackAgent}**. You can continue.\n\n`,
              );

              void db
                .update(chatConversations)
                .set({ agentType: fallbackAgent })
                .where(eq(chatConversations.id, sessionId))
                .catch(() => {});
              return;
            } catch (fallbackErr) {
              console.warn(`[AgentProcessManager] Fallback ${fallbackAgent} also failed:`, fallbackErr);
            }
          }
          console.error(`[AgentProcessManager] All fallback agents failed for session ${sessionId}`);
          actor.handleAgentOutput(
            `No AI agents are available on this host. Please check the System page for agent installation status.\n`,
          );
          actor.setStatus("error", "No agent available");
        })();
        return;
      }

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

    if (initialPrompt) {
      if (agentType === "claude") {
        // Claude uses per-message spawning — send via sendInput, not sentinel stdin
        setTimeout(() => {
          this.sendInput(sessionId, initialPrompt);
        }, 500);
      } else if (child.stdin?.writable) {
        child.stdin.on("error", () => {}); // Prevent EPIPE crash
        const formatted = adapter.formatInput(initialPrompt);
        child.stdin.write(formatted);
      }
    } else if (agentType !== "claude" && child.stdin?.writable) {
      // No initial prompt (e.g., fallback from usage limit) — send handshake only
      // so the agent is ready when the user types
      child.stdin.on("error", () => {});
      const handshake = adapter.formatInput(""); // triggers initialize + thread/start
      if (handshake.trim()) {
        child.stdin.write(handshake);
      }
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
      actor.handleAgentExit(exitCode ?? null, signal != null ? String(signal) : null);
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
      const args = [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
      ];

      // Use --resume to continue conversation if we have a Claude session ID
      if (managed.claudeSessionId) {
        args.push("--resume", managed.claudeSessionId);
        console.log(`[AgentProcessManager] Spawning Claude --resume ${managed.claudeSessionId} for session ${sessionId}`);
      } else {
        console.log(`[AgentProcessManager] Spawning new Claude conversation for session ${sessionId}`);
      }

      // Use the session's working directory (set by executeTask to the repo path)
      const cwd = actor.workingDirectory && actor.workingDirectory !== "/"
        ? actor.workingDirectory
        : process.env.HOME || "/";

      console.log(`[AgentProcessManager] Claude cwd: ${cwd}`);

      const child = spawn("claude", args, {
        cwd,
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
      case "output": {
        const outputText = (event.data.text as string) ?? "";
        actor.handleAgentOutput(outputText);

        // Detect usage limit / rate limit messages and cascade to next agent
        const isUsageLimit =
          /out of (extra )?usage/i.test(outputText) ||
          /rate.?limit/i.test(outputText) ||
          /usage.*resets/i.test(outputText);

        if (isUsageLimit && managed.agentType !== "codex") {
          const currentAgent = managed.agentType;
          const nextAgent = currentAgent === "claude" ? "codex" : "gemini";
          const agentDisplayName: Record<string, string> = {
            claude: "Claude",
            codex: "Codex",
            gemini: "Gemini",
          };
          console.warn(
            `[AgentProcessManager] ${currentAgent} hit usage limit for session ${sessionId}, falling back to ${nextAgent}`,
          );

          // Show a clear system message to the user
          actor.handleAgentOutput(
            `\n\n---\n**${agentDisplayName[currentAgent] ?? currentAgent}** reached its usage limit. Switching to **${agentDisplayName[nextAgent] ?? nextAgent}**...\n\n`,
          );

          // Stop the current session and start with fallback agent
          void this.stopSession(sessionId).then(() => {
            void this.startSession({
              sessionId,
              agentType: nextAgent,
              workingDirectory: managed.actor.workingDirectory ?? "/",
              initialPrompt: undefined,
              actor: managed.actor,
            }).then(() => {
              void db
                .update(chatConversations)
                .set({ agentType: nextAgent })
                .where(eq(chatConversations.id, sessionId))
                .catch(() => {});
              actor.handleAgentOutput(
                `Switched to **${agentDisplayName[nextAgent] ?? nextAgent}**. You can continue your conversation.\n\n`,
              );
              console.log(`[AgentProcessManager] Usage limit fallback to ${nextAgent} succeeded`);
            }).catch((err) => {
              actor.handleAgentOutput(
                `Failed to switch to ${agentDisplayName[nextAgent] ?? nextAgent}. Please try again later.\n`,
              );
              console.error(`[AgentProcessManager] Usage limit fallback to ${nextAgent} failed:`, err);
            });
          });
        }
        break;
      }

      case "tool_call": {
        const toolName = event.data.name as string;

        // Intercept cookie tool calls — fetch from Bob API and return result
        if (isCookieToolCall(toolName)) {
          const cookieToolCallId = event.data.toolCallId as string;
          const cookieArgs = (event.data.arguments as string) ?? "{}";
          actor.handleToolCall(cookieToolCallId, toolName, cookieArgs);
          void handleCookieToolCall(
            actor.sessionId,
            toolName,
            cookieArgs,
          ).then((result) => {
            actor.handleToolResult(cookieToolCallId, result, false);
          }).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            actor.handleToolResult(cookieToolCallId, JSON.stringify({ error: `Cookie fetch failed: ${message}` }), false);
          });
          break;
        }

        actor.handleToolCall(
          event.data.toolCallId as string,
          toolName,
          (event.data.arguments as string) ?? "{}",
        );

        // Detect delegation/sub-agent tool calls for hybrid multi-agent visibility
        const isDelegation = /^(delegate|agent|spawn_agent|sub_?agent)/i.test(toolName);
        if (isDelegation) {
          console.log(
            `[AgentProcessManager] Delegation detected in session ${sessionId}: ${toolName}`,
          );
          actor.handleAgentOutput(
            `[delegation] Sub-agent started: ${toolName}\n`,
            "stdout",
          );

          // Track this delegation for pairing with its result
          if (!managed.activeDelegations) {
            managed.activeDelegations = new Map();
          }
          const toolCallId = event.data.toolCallId as string;
          managed.activeDelegations.set(toolCallId, {
            toolName,
            startedAt: Date.now(),
          });

          // Fire-and-forget: write delegation_started lifecycle event
          void this.writeDelegationEvent(sessionId, "delegation_started", {
            toolName,
            arguments: event.data.arguments,
          });
        }
        break;
      }

      case "tool_result": {
        const resultToolCallId = event.data.toolCallId as string;
        const resultText = (event.data.result as string) ?? "";
        const isError = (event.data.isError as boolean) ?? false;

        actor.handleToolResult(resultToolCallId, resultText, isError);

        // Check if this completes a tracked delegation
        const delegation = managed.activeDelegations?.get(resultToolCallId);
        if (delegation) {
          managed.activeDelegations!.delete(resultToolCallId);
          const durationMs = Date.now() - delegation.startedAt;

          console.log(
            `[AgentProcessManager] Delegation completed in session ${sessionId}: ${delegation.toolName} (${durationMs}ms)`,
          );

          // Fire-and-forget: write delegation_completed lifecycle event
          void this.writeDelegationEvent(sessionId, "delegation_completed", {
            toolName: delegation.toolName,
            durationMs,
            isError,
            resultPreview: resultText.slice(0, 500),
          });

          // Task 3: Sub-run promotion if result looks like it produced artifacts
          if (!isError && looksLikeArtifact(resultText)) {
            void this.promoteToChildRun(sessionId, delegation.toolName, resultText);
          }
        }
        break;
      }

      case "status":
        // Status events are informational — log them
        console.log(`[AgentProcessManager] Status for session ${sessionId}:`, event.data);
        if (
          typeof event.data.followUpInput === "string" &&
          event.data.followUpInput.length > 0 &&
          managed.process.stdin?.writable
        ) {
          const followUp = event.data.followUpInput.endsWith("\n")
            ? event.data.followUpInput
            : `${event.data.followUpInput}\n`;
          managed.process.stdin.write(followUp);
        }
        break;

      case "error":
        actor.handleAgentOutput(`Error: ${event.data.message ?? "Unknown error"}\n`, "stderr");
        break;
    }
  }

  /**
   * Look up the taskRunId for a gateway session and write a lifecycle event.
   * Fire-and-forget — errors are logged at warn level.
   */
  private async writeDelegationEvent(
    sessionId: string,
    eventType: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const taskRun = await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, sessionId),
        columns: { id: true, runPhase: true, workItemId: true },
      });
      if (!taskRun) {
        console.warn(`[AgentProcessManager] No taskRun found for session ${sessionId}, skipping lifecycle event`);
        return;
      }
      await db.insert(runLifecycleEvents).values({
        taskRunId: taskRun.id,
        workItemId: taskRun.workItemId ?? undefined,
        sessionId,
        eventType,
        phase: taskRun.runPhase ?? "execute",
        metadata,
      });
    } catch (err) {
      console.warn("[AgentProcessManager] Failed to write delegation event:", err);
    }
  }

  /**
   * When a delegation result contains artifact patterns, create a child taskRun.
   * Fire-and-forget — errors are logged at warn level.
   */
  private async promoteToChildRun(
    sessionId: string,
    toolName: string,
    resultText: string,
  ): Promise<void> {
    try {
      const parentRun = await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, sessionId),
        columns: {
          id: true,
          userId: true,
          planningWorkspaceId: true,
          planningItemId: true,
          planningItemIdentifier: true,
          workItemId: true,
          workItemIdentifierSnapshot: true,
          repositoryId: true,
          runPhase: true,
        },
      });
      if (!parentRun) return;

      const [childRun] = await db
        .insert(taskRuns)
        .values({
          userId: parentRun.userId,
          planningWorkspaceId: parentRun.planningWorkspaceId,
          planningItemId: parentRun.planningItemId,
          planningItemIdentifier: parentRun.planningItemIdentifier,
          workItemId: parentRun.workItemId,
          workItemIdentifierSnapshot: parentRun.workItemIdentifierSnapshot,
          repositoryId: parentRun.repositoryId,
          parentTaskRunId: parentRun.id,
          runPhase: parentRun.runPhase ?? "execute",
          status: "completed",
          completedAt: new Date(),
        })
        .returning({ id: taskRuns.id });

      if (childRun) {
        console.log(
          `[AgentProcessManager] Promoted delegation "${toolName}" to child run ${childRun.id} (parent=${parentRun.id})`,
        );
      }
    } catch (err) {
      console.warn("[AgentProcessManager] Failed to promote delegation to child run:", err);
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
