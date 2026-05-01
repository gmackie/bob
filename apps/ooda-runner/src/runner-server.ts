import { hostname } from "node:os";

import type { RunnerConfig } from "./config";
import { SessionManager } from "./session/session-manager";
import { SessionExecutor } from "./session/session-executor";
import { CodexAdapter } from "@gmacko/ooda/agent-adapters";
import { ClaudeAdapter } from "@gmacko/ooda/agent-adapters";
import type { AgentAdapter } from "@gmacko/ooda/agent-adapters";
import { generateRunnerToken } from "./auth/auth";
import { promoteNote } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";
import {
  createRunnerTRPCClient,
  type RunnerTRPCClient,
} from "./trpc-client";

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

export class RunnerServer {
  public readonly sessions: SessionManager;
  private adapters: Map<string, AgentAdapter>;
  private trpc: RunnerTRPCClient;
  private runnerId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeSessions = new Set<string>();

  constructor(private config: RunnerConfig) {
    this.sessions = new SessionManager();
    this.trpc = createRunnerTRPCClient(config.serverUrl);

    // Register available adapters
    this.adapters = new Map();
    const codex = new CodexAdapter();
    const claude = new ClaudeAdapter();
    if (codex.isAvailable()) this.adapters.set("codex", codex);
    if (claude.isAvailable()) this.adapters.set("claude", claude);
  }

  getAdapter(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  createExecutor(adapterId: string): SessionExecutor {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Adapter not available: ${adapterId}`);
    }
    return new SessionExecutor({
      adapter,
      storageRoot: this.config.storageRoot,
    });
  }

  async start(): Promise<void> {
    console.log("[runner] starting...");
    console.log(
      `[runner] available adapters: ${[...this.adapters.keys()].join(", ") || "none"}`,
    );
    console.log(`[runner] server URL: ${this.config.serverUrl}`);

    // Generate or load token
    const token = generateRunnerToken(this.config.storageRoot);
    console.log(`[runner] token ready (${token.slice(0, 8)}...)`);

    // Register with web app
    await this.register();

    // Start heartbeat loop
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Start session polling loop
    this.pollTimer = setInterval(() => {
      void this.pollForSessions();
    }, POLL_INTERVAL_MS);

    console.log("[runner] healthy");
  }

  private async register(): Promise<void> {
    try {
      const [device] = await this.trpc.runner.register.mutate({
        name: this.config.runnerName,
        hostname: hostname(),
        capabilities: [...this.adapters.keys()],
      });

      if (device) {
        this.runnerId = device.id;
        console.log(
          `[runner] registered as device ${device.id} (${hostname()})`,
        );
      }
    } catch (err) {
      console.error(
        "[runner] registration failed (web app may not be running yet):",
        err instanceof Error ? err.message : err,
      );
      // Runner continues — will retry on next heartbeat
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.runnerId) {
      // Try registering again if initial registration failed
      await this.register();
      return;
    }

    try {
      await this.trpc.runner.heartbeat.mutate({
        runnerId: this.runnerId,
      });
      console.log("[runner] heartbeat OK");
    } catch (err) {
      console.warn(
        "[runner] heartbeat failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async pollForSessions(): Promise<void> {
    if (!this.runnerId) return;

    try {
      const sessions = await this.trpc.runner.listSessionsByRunner.query({
        runnerId: this.runnerId,
      });

      // Find pending sessions assigned to this runner
      for (const session of sessions) {
        if (
          session.status === "pending" &&
          session.runnerId === this.runnerId &&
          !this.activeSessions.has(session.id)
        ) {
          // Atomically claim the session by setting status to running
          // If another poll already claimed it, this returns empty
          const claimed = await this.trpc.runner.claimSession.mutate({
            sessionId: session.id,
          });
          if (!claimed) continue;

          this.activeSessions.add(session.id);
          void this.executeSession(session);
        }
      }
    } catch {
      // Polling failures are expected during startup
    }
  }

  private async executeSession(session: {
    id: string;
    threadId: string;
    adapterId: string;
    toolProfileId: string;
  }): Promise<void> {
    console.log(`[runner] executing session ${session.id}`);

    try {
      // Get the prompt from session events
      const events = await this.trpc.runner.getSessionEvents.query({
        sessionId: session.id,
      });
      const promptEvent = events.find((e: { type: string }) => e.type === "prompt");
      if (!promptEvent) {
        throw new Error("No prompt found for session");
      }

      // Get thread info for workspace creation
      const thread = await this.trpc.threads.byId.query({
        id: session.threadId,
      });
      if (!thread) {
        throw new Error(`Thread not found: ${session.threadId}`);
      }

      // Status already set to "running" by claimSession
      // Create executor and run
      const executor = this.createExecutor(session.adapterId);

      const result = await executor.execute({
        threadSlug: thread.slug,
        threadTitle: thread.title,
        sessionId: session.id,
        prompt: promptEvent.content,
        toolProfileId: session.toolProfileId,
        onEvent: (event) => {
          if (event.type === "stdout") {
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "stdout_chunk",
              content: event.data,
            });
          }
          if (event.type === "exit") {
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "exit",
              content: event.data,
            });
          }
        },
      });

      // Push the parsed agent response as a final stdout event
      if (result.agentResponse) {
        await this.trpc.runner.pushSessionEvent.mutate({
          sessionId: session.id,
          type: "stdout",
          content: result.agentResponse,
        });
      }

      // Mark completed
      await this.trpc.runner.updateSessionStatus.mutate({
        sessionId: session.id,
        status: result.exitCode === 0 ? "completed" : "failed",
        exitCode: result.exitCode,
      });

      console.log(
        `[runner] session ${session.id} completed (exit ${result.exitCode})`,
      );
    } catch (err) {
      console.error(`[runner] session ${session.id} failed:`, err);
      await this.trpc.runner.updateSessionStatus
        .mutate({
          sessionId: session.id,
          status: "failed",
        })
        .catch(() => {});
    } finally {
      this.activeSessions.delete(session.id);
    }
  }

  async executePromotion(params: {
    sessionId: string;
    threadSlug: string;
    /** Thread UUID for entity extraction. */
    threadId?: string;
    kind: "observation" | "hypothesis" | "action" | "reflection" | "source-extract";
    title: string;
    content: string;
  }): Promise<{ noteId: string; artifactId: string }> {
    const threadDir = resolveThreadPath(
      this.config.storageRoot,
      params.threadSlug,
    );

    const result = await promoteNote({
      storageRoot: this.config.storageRoot,
      threadDir,
      sessionId: params.sessionId,
      kind: params.kind,
      title: params.title,
      content: params.content,
      threadId: params.threadId,
      provenance: {
        capabilityId: "chat-promote",
        operationId: `promote-${Date.now()}`,
        sourceType: "agent",
        queryOrInputRef: `session:${params.sessionId}`,
      },
    });

    // Push a promotion_available event so the UI knows
    await this.trpc.runner.pushSessionEvent.mutate({
      sessionId: params.sessionId,
      type: "promotion_available",
      content: JSON.stringify({
        noteId: result.noteId,
        artifactId: result.artifactId,
        kind: params.kind,
        title: params.title,
      }),
    });

    return { noteId: result.noteId, artifactId: result.artifactId };
  }

  getRunnerId(): string | null {
    return this.runnerId;
  }

  getTRPC(): RunnerTRPCClient {
    return this.trpc;
  }

  async stop(): Promise<void> {
    console.log("[runner] shutting down");
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
