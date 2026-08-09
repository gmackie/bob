import { hostname } from "node:os";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { RunnerConfig } from "./config";
import { SessionManager } from "./session/session-manager";
import { SessionExecutor } from "./session/session-executor";
import { CodexAdapter } from "@gmacko/ooda/agent-adapters";
import { ClaudeAdapter } from "@gmacko/ooda/agent-adapters";
import { GrokAdapter } from "@gmacko/ooda/agent-adapters";
import { BuddyMcpServer } from "@gmacko/ooda/agent-adapters";
import type { AgentAdapter } from "@gmacko/ooda/agent-adapters";
import { generateRunnerToken } from "./auth/auth";
import { promoteNote } from "@gmacko/ooda/thread-workspace";
import { resolveThreadPath } from "@gmacko/ooda/thread-model";
import { buildOutcomeNote } from "./ooda-callback.js";
import {
  createRunnerTRPCClient,
  createResearchSurface,
  type RunnerTRPCClient,
} from "./trpc-client";
import { CapabilityRegistry } from "@gmacko/ooda/capability-registry";
import type { ResearchTRPCSurface } from "@gmacko/ooda/buddy-tools";
import { BobGatewayConnector } from "./bob-gateway";
import { BobRunReporter } from "./bob-run-reporter";
import { AgentJobWorker } from "./agent-jobs/agent-job-worker";
import { BobDomainAdapter } from "@gmacko/ooda/integrations";
import { IntegrationDeliveryWorker } from "./integrations/integration-delivery-worker";
import { HostTurnWorker } from "./host-turns/host-turn-worker";

const HEARTBEAT_INTERVAL_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
// Sweep stale runner_session rows (runner died mid-run) periodically. Long
// interval — the server-side grace is 6h, so there's no value polling often.
const REAP_INTERVAL_MS = 30 * 60_000;

type PromotionKind =
  | "observation"
  | "hypothesis"
  | "action"
  | "reflection"
  | "source-extract";

interface PromotionRequestPayload {
  kind: PromotionKind;
  title: string;
  content: string;
  threadId: string;
  runnerId: string;
}

function ensureStorageRoot(storageRoot: string): void {
  mkdirSync(storageRoot, { recursive: true });
  if (existsSync(join(storageRoot, ".git"))) return;
  execSync("git init", { cwd: storageRoot, stdio: "pipe" });
}

function isPromotionKind(value: unknown): value is PromotionKind {
  return (
    value === "observation" ||
    value === "hypothesis" ||
    value === "action" ||
    value === "reflection" ||
    value === "source-extract"
  );
}

function parsePromotionRequest(
  content: string,
): PromotionRequestPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  if (!isPromotionKind(payload.kind)) return null;
  if (typeof payload.title !== "string" || payload.title.length === 0)
    return null;
  if (typeof payload.content !== "string" || payload.content.length === 0)
    return null;
  if (typeof payload.threadId !== "string" || payload.threadId.length === 0)
    return null;
  if (typeof payload.runnerId !== "string" || payload.runnerId.length === 0)
    return null;

  return {
    kind: payload.kind,
    title: payload.title,
    content: payload.content,
    threadId: payload.threadId,
    runnerId: payload.runnerId,
  };
}

// Phase 2: distill a "Remember this" conversation transcript into a durable
// vault note via a one-shot Anthropic call. Direct fetch (no SDK dep). Always
// returns *something* — falls back to the verbatim transcript when the API key
// is absent, the input is trivially short, or the call fails, so a note is
// never lost. The full transcript is folded under a collapsed section for
// provenance/recall. Model is overridable via OODA_DISTILL_MODEL.
async function distillConversation(
  transcript: string,
  title: string,
): Promise<{ content: string; distilled: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const raw = { content: transcript, distilled: false };
  if (!apiKey || transcript.trim().length < 200) return raw;

  const model = process.env.OODA_DISTILL_MODEL ?? "claude-sonnet-5";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system:
          "You distill a conversation into a durable research note for a personal Obsidian knowledge vault. " +
          "Output GitHub-flavored markdown only, no preamble: a one-line **Summary**, a **Key points** bullet list (3-7), " +
          "any **Decisions** or **Open questions** if present, and a final `Topics:` line of 3-8 lowercase hashtags. " +
          "Be faithful and concise; capture what is worth remembering, not filler.",
        messages: [
          {
            role: "user",
            content: `Conversation titled "${title}":\n\n${transcript.slice(0, 24000)}`,
          },
        ],
      }),
    });
    if (!res.ok) return raw;
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return raw;
    const note = `${text}\n\n---\n\n<details>\n<summary>Full transcript</summary>\n\n${transcript}\n\n</details>\n`;
    return { content: note, distilled: true };
  } catch {
    return raw;
  }
}

export class RunnerServer {
  public readonly sessions: SessionManager;
  private adapters: Map<string, AgentAdapter>;
  private trpc: RunnerTRPCClient;
  private runnerId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private activeSessions = new Set<string>();
  private activePromotions = new Set<string>();
  private bobGateway: BobGatewayConnector | null = null;
  private bobReporter: BobRunReporter;
  private research: ResearchTRPCSurface;
  private capabilityRegistry: CapabilityRegistry;
  private buddyMcpServer: BuddyMcpServer;
  private agentJobWorker: AgentJobWorker | null = null;
  private hostTurnWorker: HostTurnWorker | null = null;
  private integrationDeliveryWorker: IntegrationDeliveryWorker | null = null;

  constructor(private config: RunnerConfig) {
    this.sessions = new SessionManager();
    this.trpc = createRunnerTRPCClient(config.serverUrl);
    // Buddy-tool wiring: research surface the tool handlers call, plus a
    // capability registry that gates the exposed tool set by profile. The
    // registry is unseeded today, so profile gating falls back to the full
    // implemented tool set (see SessionExecutor.allowedToolNames).
    this.research = createResearchSurface(this.trpc);
    this.capabilityRegistry = new CapabilityRegistry();
    // In-process HTTP MCP server: one shared loopback listener that exposes
    // each session's gated buddy tools to the agent (Grok connects out to it
    // via session/new.mcpServers). Started in start(); each session registers
    // + disposes its own descriptor set (see SessionExecutor).
    this.buddyMcpServer = new BuddyMcpServer();

    // Report run status + output to Bob's public API so OODA-originated work is
    // monitorable/reviewable in the Bob dashboard. No-ops unless bob* env is set.
    this.bobReporter = new BobRunReporter({
      baseUrl: config.bobApiUrl,
      apiKey: config.bobApiKey,
      workspaceId: config.bobWorkspaceId,
    });

    // Register available adapters
    this.adapters = new Map();
    const codex = new CodexAdapter();
    const claude = new ClaudeAdapter();
    const grok = new GrokAdapter();
    if (codex.isAvailable()) this.adapters.set("codex", codex);
    if (claude.isAvailable()) this.adapters.set("claude", claude);
    if (grok.isAvailable()) this.adapters.set("grok", grok);

    // Bob gateway connector (optional — only starts if BOB_GATEWAY_URL is set)
    if (config.bobGatewayUrl && config.bobApiKey && config.bobWorkspaceId) {
      this.bobGateway = new BobGatewayConnector(
        {
          gatewayUrl: config.bobGatewayUrl,
          apiKey: config.bobApiKey,
          workspaceId: config.bobWorkspaceId,
          devDir: config.bobDevDir,
          maxConcurrent: config.bobMaxConcurrent,
          // Phase 5 M2: write an OODA-dispatched run's outcome back into its
          // originating thread as a provenance-stamped note. Only fires for
          // sessions carrying an ooda correlation (dark until M1 is enabled).
          onBobOutcome: async (correlation, outcome) => {
            const threadDir = resolveThreadPath(
              this.config.storageRoot,
              correlation.threadSlug,
            );
            const { title, content } = buildOutcomeNote(outcome);
            await promoteNote({
              storageRoot: this.config.storageRoot,
              threadDir,
              sessionId: outcome.sessionId,
              kind: "action",
              title,
              content,
              threadId: correlation.threadId,
              provenance: {
                capabilityId: "bob-run",
                operationId: `bob-run-${outcome.sessionId}`,
                sourceType: "agent",
                queryOrInputRef: `bobRun:${outcome.sessionId}`,
                canonicalSourceRef: outcome.pullRequestUrl ?? undefined,
              },
            });
          },
        },
        this.adapters,
      );
    }
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
      research: this.research,
      capabilityRegistry: this.capabilityRegistry,
      mcpServer: this.buddyMcpServer,
    });
  }

  async start(): Promise<void> {
    console.log("[runner] starting...");
    console.log(
      `[runner] available adapters: ${[...this.adapters.keys()].join(", ") || "none"}`,
    );
    console.log(`[runner] server URL: ${this.config.serverUrl}`);
    ensureStorageRoot(this.config.storageRoot);

    // Bring up the in-process MCP server before any session can claim work,
    // so buddy tools are advertisable on the first session/new.
    await this.buddyMcpServer.start();
    console.log(
      `[runner] buddy MCP server listening on ${this.buddyMcpServer.address.host}:${this.buddyMcpServer.address.port}`,
    );

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
      void this.agentJobWorker?.poll();
      void this.hostTurnWorker?.poll();
      void this.integrationDeliveryWorker?.poll();
    }, POLL_INTERVAL_MS);

    // Start stale-session reaper loop
    this.reapTimer = setInterval(() => {
      void this.reapStaleSessions();
    }, REAP_INTERVAL_MS);

    // Start Bob gateway connector if configured
    if (this.bobGateway) {
      this.bobGateway.start();
      console.log("[runner] Bob gateway connector started");
    }

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
        if (!this.agentJobWorker) {
          this.agentJobWorker = new AgentJobWorker({
            runnerId: device.id,
            scratchRoot: this.config.agentJobScratchRoot,
            adapters: this.adapters,
            maxConcurrent: this.config.agentJobMaxConcurrent,
            api: {
              claim: (input) => this.trpc.jobs.claim.mutate(input),
              recordEvent: (input) => this.trpc.jobs.recordEvent.mutate(input),
              control: (input) => this.trpc.jobs.control.query(input),
            },
          });
        }
        if (!this.hostTurnWorker && this.config.hostTurnEnabled) {
          this.hostTurnWorker = new HostTurnWorker({
            runnerId: device.id,
            scratchRoot: this.config.hostTurnScratchRoot,
            adapters: this.adapters,
            maxConcurrent: this.config.hostTurnMaxConcurrent,
            models: {
              ...(this.config.grokHostModel
                ? { grok: this.config.grokHostModel }
                : {}),
              ...(this.config.claudeHostModel
                ? { claude: this.config.claudeHostModel }
                : {}),
              ...(this.config.openaiHostModel
                ? { openai: this.config.openaiHostModel }
                : {}),
            },
            api: {
              claim: (input) => this.trpc.host.claim.mutate(input),
              complete: (input) => this.trpc.host.complete.mutate(input),
              fail: (input) => this.trpc.host.fail.mutate(input),
            },
          });
        }
        if (
          !this.integrationDeliveryWorker &&
          this.config.bobDeliveryEnabled &&
          this.config.bobApiUrl &&
          this.config.bobApiKey &&
          this.config.bobWorkspaceId
        ) {
          this.integrationDeliveryWorker = new IntegrationDeliveryWorker({
            runnerId: device.id,
            adapters: new Map([
              [
                "bob",
                new BobDomainAdapter({
                  apiUrl: this.config.bobApiUrl,
                  apiKey: this.config.bobApiKey,
                  workspaceId: this.config.bobWorkspaceId,
                }),
              ],
            ]),
            api: {
              claim: (input) => this.trpc.integrations.claim.mutate(input),
              complete: (input) =>
                this.trpc.integrations.complete.mutate(input),
              fail: (input) => this.trpc.integrations.fail.mutate(input),
            },
          });
        }
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

      await this.processPromotionRequests(sessions);
    } catch {
      // Polling failures are expected during startup
    }
  }

  private async processPromotionRequests(
    sessions: {
      id: string;
      threadId: string;
      runnerId: string;
    }[],
  ): Promise<void> {
    for (const session of sessions) {
      const events = await this.trpc.runner.getSessionEvents.query({
        sessionId: session.id,
      });

      const completedPromotionIds = new Set<string>();
      for (const event of events) {
        if (event.type !== "promotion_available") continue;
        try {
          const content = JSON.parse(event.content) as {
            sourceEventId?: string;
          };
          if (content.sourceEventId)
            completedPromotionIds.add(content.sourceEventId);
        } catch {
          // Ignore legacy/invalid promotion events.
        }
      }

      for (const event of events) {
        if (event.type !== "promote_request") continue;
        if (this.activePromotions.has(event.id)) continue;
        if (completedPromotionIds.has(event.id)) continue;

        const request = parsePromotionRequest(event.content);
        if (!request || request.runnerId !== session.runnerId) continue;

        this.activePromotions.add(event.id);
        try {
          const thread = await this.trpc.threads.byId.query({
            id: request.threadId,
          });
          if (!thread?.slug || !thread?.title) {
            throw new Error(`Thread not found: ${request.threadId}`);
          }

          await this.executePromotion({
            sessionId: session.id,
            sourceEventId: event.id,
            threadSlug: thread.slug,
            threadId: request.threadId,
            kind: request.kind,
            title: request.title,
            content: request.content,
          });
        } catch (error) {
          await this.trpc.runner.pushSessionEvent
            .mutate({
              sessionId: session.id,
              type: "promotion_error",
              content: JSON.stringify({
                sourceEventId: event.id,
                message: error instanceof Error ? error.message : String(error),
              }),
            })
            .catch(() => {});
        } finally {
          this.activePromotions.delete(event.id);
        }
      }
    }
  }

  private async executeSession(session: {
    id: string;
    threadId: string;
    adapterId: string;
    toolProfileId: string;
  }): Promise<void> {
    console.log(`[runner] executing session ${session.id}`);

    // Bob run reporting state (best-effort; never breaks execution).
    let bobRunId: string | null = null;
    let bobLog = "";
    let bobFlush: ReturnType<typeof setInterval> | null = null;

    try {
      // Get the prompt from session events
      const events = await this.trpc.runner.getSessionEvents.query({
        sessionId: session.id,
      });
      const promptEvent = events.find(
        (e: { type: string }) => e.type === "prompt",
      );
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

      // Open a Bob run so this work is visible in the Bob dashboard, and flush
      // accumulated output periodically so progress is reviewable mid-run.
      bobRunId = await this.bobReporter.startRun({
        workItemId: thread.slug ?? session.id,
        agentType: session.adapterId,
        title: thread.title,
      });
      if (bobRunId) {
        bobFlush = setInterval(() => {
          void this.bobReporter.pushLog(bobRunId, bobLog);
        }, 10_000);
      }

      // Status already set to "running" by claimSession
      // Create executor and run
      const executor = this.createExecutor(session.adapterId);

      const result = await executor.execute({
        threadSlug: thread.slug,
        threadTitle: thread.title,
        sessionId: session.id,
        threadId: session.threadId,
        prompt: promptEvent.content,
        toolProfileId: session.toolProfileId,
        onEvent: (event) => {
          if (event.type === "stdout") {
            bobLog += event.data;
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "stdout_chunk",
              content: event.data,
            });
          }
          if (event.type === "stderr") {
            bobLog += event.data;
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "stderr_chunk",
              content: event.data,
            });
          }
          if (event.type === "thought") {
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "thought",
              content: event.thought?.text ?? event.data,
            });
          }
          if (event.type === "tool_call" || event.type === "tool_result") {
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "tool_call",
              content: JSON.stringify({
                phase: event.type === "tool_call" ? "start" : "end",
                ...event.tool,
              }),
            });
          }
          if (event.type === "error") {
            void this.trpc.runner.pushSessionEvent.mutate({
              sessionId: session.id,
              type: "error",
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
        bobLog += `\n${result.agentResponse}`;
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

      // Bob: final output + terminal status.
      if (bobFlush) clearInterval(bobFlush);
      await this.bobReporter.pushLog(bobRunId, bobLog);
      await this.bobReporter.finishRun(
        bobRunId,
        result.exitCode === 0 ? "completed" : "failed",
        { exitCode: result.exitCode },
      );

      console.log(
        `[runner] session ${session.id} completed (exit ${result.exitCode})`,
      );
    } catch (err) {
      console.error(`[runner] session ${session.id} failed:`, err);
      const message = err instanceof Error ? err.message : String(err);
      await this.trpc.runner.pushSessionEvent
        .mutate({
          sessionId: session.id,
          type: "error",
          content: message,
        })
        .catch(() => {});
      await this.trpc.runner.updateSessionStatus
        .mutate({
          sessionId: session.id,
          status: "failed",
        })
        .catch(() => {});

      // Bob: report failure with whatever output we captured.
      if (bobFlush) clearInterval(bobFlush);
      await this.bobReporter.pushLog(bobRunId, bobLog);
      await this.bobReporter.finishRun(bobRunId, "failed", { error: message });
    } finally {
      if (bobFlush) clearInterval(bobFlush);
      this.activeSessions.delete(session.id);
    }
  }

  async executePromotion(params: {
    sessionId: string;
    sourceEventId?: string;
    threadSlug: string;
    /** Thread UUID for entity extraction. */
    threadId?: string;
    kind:
      | "observation"
      | "hypothesis"
      | "action"
      | "reflection"
      | "source-extract";
    title: string;
    content: string;
  }): Promise<{ noteId: string; artifactId: string }> {
    const threadDir = resolveThreadPath(
      this.config.storageRoot,
      params.threadSlug,
    );

    // "Remember this conversation" (source-extract) → have the agent distill the
    // raw transcript into a clean vault note before committing. Falls back to the
    // verbatim transcript if distillation is unavailable or fails, so a note is
    // always written. Other promotion kinds (single observation/etc.) stay raw.
    let noteContent = params.content;
    if (params.kind === "source-extract") {
      const distilled = await distillConversation(params.content, params.title);
      noteContent = distilled.content;
    }

    const result = await promoteNote({
      storageRoot: this.config.storageRoot,
      threadDir,
      sessionId: params.sessionId,
      kind: params.kind,
      title: params.title,
      content: noteContent,
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
        sourceEventId: params.sourceEventId,
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

  private async reapStaleSessions(): Promise<void> {
    try {
      const result = (await this.trpc.runner.reapStaleSessions.mutate({})) as {
        reaped: number;
      };
      if (result?.reaped > 0) {
        console.log(`[runner] reaped ${result.reaped} stale runner session(s)`);
      }
    } catch (err) {
      console.error("[runner] stale-session reap failed (will retry):", err);
    }
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
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    if (this.bobGateway) {
      this.bobGateway.stop();
    }
    await this.agentJobWorker?.stop();
    this.agentJobWorker = null;
    await this.hostTurnWorker?.stop();
    this.hostTurnWorker = null;
    this.integrationDeliveryWorker?.stop();
    this.integrationDeliveryWorker = null;
    await this.buddyMcpServer.stop();
  }
}
