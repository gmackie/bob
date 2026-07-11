import type { WebSocket } from "ws";
import { eq, and, gt, lt, inArray, asc, desc, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, repositories, sessionEvents, taskRuns, workItems, agentRuns, activities, workspaces, tenants, tenantMembers, planDrafts, pullRequests } from "@bob/db/schema";

import {
  parseClientMessage,
  encodeServerMessage,
  createError,
  type ClientMessage,
  type ClientHello,
  type ClientSubscribe,
  type ClientUnsubscribe,
  type ClientInput,
  type ClientStopSession,
  type ClientSessionEvent,
  type ClientSessionStatus,
  type ClientSessionClaimed,
  type ClientSubscribeWorkspace,
  type ServerMessage,
  type ServerWorkspaceInvalidationType,
  type SessionStatus,
  type HostSnapshotWire,
} from "./protocol.js";
import type { SessionEventRecord } from "./persistence.js";
import { pushToUser } from "./push.js";
import { parsePrUrl } from "./pr-url.js";

const REPLAY_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

interface Connection {
  id: string;
  ws: WebSocket;
  kind: "browser" | "daemon" | "unauth";
  userId: string | null;
  workspaceId: string | null; // set for daemon
  clientId: string;
  subscribedSessions: Set<string>;
  heartbeatTimer: NodeJS.Timeout | null;
  alive: boolean;
  workspaceSubscribed: boolean;
  workspaceScopeId?: string;
  workspaceStatusFilter?: SessionStatus[];
  hostSnapshot?: HostSnapshotWire;
}

interface NudgeInput {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
  sessionType?: "execution" | "planning";
  planningContext?: {
    workspaceId: string;
    projectId: string;
    projectName: string;
    launchContext?: unknown;
  };
  description?: string;
  identifier?: string;
  branch?: string;
  personaId?: string;
  personaConfig?: {
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    autonomyLevel?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface RelayConfig {
  heartbeatIntervalMs: number;
  persistEvent: (event: SessionEventRecord) => Promise<void> | void;
  validateBrowserToken: (token: string) => Promise<string | null>;
  validateDaemonAuth: (token: string, workspaceId: string) => Promise<string | null>;
}

export class Relay {
  private readonly cfg: RelayConfig;
  private readonly connections = new Map<string, Connection>();
  private readonly clientsByUser = new Map<string, Set<Connection>>();
  private readonly daemonByWorkspace = new Map<string, Connection>();
  private readonly subscribers = new Map<string, Set<Connection>>();
  private nextConnId = 0;

  private timeoutSweepTimer: NodeJS.Timeout | null = null;

  constructor(cfg: RelayConfig) {
    this.cfg = cfg;
    this.timeoutSweepTimer = setInterval(() => {
      this.sweepTimedOutSessions().catch((err) => {
        console.error("[Relay] Timeout sweep failed (will retry next interval):", err);
      });
    }, 60_000);
  }

  private async sweepTimedOutSessions(): Promise<void> {
    // Key off inactivity, not age: a healthy long run keeps emitting events
    // (lastActivityAt is bumped on every session_event), while a run whose
    // daemon died goes silent and should be failed after the window.
    const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const stale = await db.query.chatConversations.findMany({
      where: and(
        // "stopping" included: if the daemon dies before confirming a stop,
        // the session would otherwise stay "stopping" forever.
        inArray(chatConversations.status, ["running", "starting", "stopping"]),
        lt(
          sql`coalesce(${chatConversations.lastActivityAt}, ${chatConversations.createdAt})`,
          cutoff,
        ),
      ),
      columns: { id: true, userId: true, workItemId: true, agentType: true },
    });

    for (const session of stale) {
      console.log(`[Relay] Timeout sweep: marking session ${session.id} as failed (>35min inactive)`);
      await db
        .update(chatConversations)
        .set({ status: "failed" })
        .where(eq(chatConversations.id, session.id));

      await db
        .update(agentRuns)
        .set({ status: "failed", completedAt: sql`now()`, summary: { reason: "timeout" } })
        .where(eq(agentRuns.sessionId, session.id));

      if (session.workItemId) {
        await db.insert(activities).values({
          workItemId: session.workItemId,
          userId: session.userId,
          type: "status_changed",
          fromValue: "running",
          toValue: "failed",
          metadata: { sessionId: session.id, reason: "timeout" },
        });
      }
    }
  }

  handleConnection(ws: WebSocket): void {
    const id = `conn-${++this.nextConnId}`;
    const conn: Connection = {
      id,
      ws,
      kind: "unauth",
      userId: null,
      workspaceId: null,
      clientId: "",
      subscribedSessions: new Set(),
      heartbeatTimer: null,
      alive: true,
      workspaceSubscribed: false,
    };
    this.connections.set(id, conn);

    // WS-level pong (response to our ping) marks connection alive
    ws.on("pong", () => {
      conn.alive = true;
    });

    // Process this connection's messages strictly in arrival order. Handlers
    // are async and hit the DB; without serialization a slow earlier message
    // (e.g. session_claimed's agent_runs bookkeeping) can finish after a later
    // one (session_status "running") and clobber its writes.
    let messageQueue: Promise<void> = Promise.resolve();
    ws.on("message", (data: Buffer | string) => {
      conn.alive = true;
      const raw = typeof data === "string" ? data : data.toString();
      messageQueue = messageQueue.then(async () => {
        const msg = parseClientMessage(raw);
        if (!msg) {
          this.send(conn, createError("INVALID_MESSAGE", "Failed to parse message"));
          return;
        }
        try {
          await this.handleMessage(conn, msg);
        } catch (err) {
          console.error(`[Relay] Error handling ${msg.type} from ${id}:`, err);
          this.send(conn, createError("INTERNAL_ERROR", "Internal error"));
        }
      });
    });

    ws.on("close", () => {
      this.cleanupConnection(conn);
    });

    ws.on("error", (err: Error) => {
      console.error(`[Relay] WebSocket error on ${id}:`, err.message);
    });
  }

  /**
   * Push a session_available message to the daemon owning the given workspace.
   * Silently drops if no daemon is connected — the daemon will pick it up
   * from the DB on next connect.
   */
  nudgeSession(input: NudgeInput): void {
    this.broadcastWorkspaceIdInvalidation(
      input.workspaceId,
      "work_item_dispatched",
      input.sessionId,
    );

    const daemon = this.daemonByWorkspace.get(input.workspaceId);
    if (!daemon) return;

    this.send(daemon, {
      type: "session_available",
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      agentType: input.agentType,
      title: input.title,
      sessionType: input.sessionType ?? "execution",
      planningContext: input.planningContext as any,
      description: input.description,
      identifier: input.identifier,
      branch: input.branch,
      personaId: input.personaId,
      personaConfig: input.personaConfig,
    });
  }

  /**
   * Send a message to a running session's daemon via HTTP (server-to-server).
   * Used by the Worker for resumeBlockedTask and forwardIssueContextUpdate.
   * Returns true if the message was delivered, false if no daemon was found.
   */
  async sendToSession(sessionId: string, userId: string, message: string): Promise<boolean> {
    const rows = await db
      .select({
        sessionUserId: chatConversations.userId,
        workspaceId: repositories.workspaceId,
      })
      .from(chatConversations)
      .leftJoin(repositories, eq(repositories.id, chatConversations.repositoryId))
      .where(eq(chatConversations.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.sessionUserId !== userId) return false;

    const daemon = row.workspaceId
      ? this.daemonByWorkspace.get(row.workspaceId) ?? null
      : this.findDaemonForUser(userId);

    if (!daemon) return false;

    this.send(daemon, {
      type: "event",
      sessionId,
      seq: 0,
      eventType: "input",
      direction: "client",
      payload: { data: message },
      createdAt: new Date().toISOString(),
    });

    return true;
  }

  getStats() {
    return {
      connections: this.connections.size,
      browserCount: Array.from(this.connections.values()).filter((c) => c.kind === "browser").length,
      daemonCount: this.daemonByWorkspace.size,
      sessionSubscriptions: this.subscribers.size,
    };
  }

  notifyWorkspaceEvent(input: {
    type: ServerWorkspaceInvalidationType;
    workspaceId: string;
    entityId?: string;
    payload?: Record<string, unknown>;
  }): void {
    this.broadcastWorkspaceIdInvalidation(
      input.workspaceId,
      input.type,
      input.entityId,
      input.payload,
    );
  }

  // ── Message dispatch ───────────────────────────────────────────────

  private async handleMessage(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        await this.handleHello(conn, msg);
        return;
      case "ping":
        this.send(conn, { type: "pong", ts: new Date().toISOString() });
        // Daemon pings double as liveness: keep lastHeartbeat fresh so
        // "runner online" reflects the live connection, not connect time.
        if (conn.kind === "daemon" && conn.workspaceId) {
          if (msg.hostSnapshot) {
            conn.hostSnapshot = msg.hostSnapshot;
            this.broadcastHostSnapshot(conn.workspaceId, msg.hostSnapshot);
          }
          await db
            .update(workspaces)
            .set({ lastHeartbeat: sql`now()` })
            .where(eq(workspaces.id, conn.workspaceId))
            .catch(() => {});
        }
        return;
    }

    if (conn.kind === "unauth") {
      this.send(conn, createError("NOT_AUTHENTICATED", "Must send hello first"));
      return;
    }

    // Helper: reject malformed sessionId before it reaches the DB, so a
    // corrupt id from any client surfaces as INVALID_SESSION_ID instead of a
    // Postgres 22P02 in the gateway logs.
    const requireUuid = (sessionId: unknown): boolean => {
      if (isUuid(sessionId)) return true;
      this.send(
        conn,
        createError("INVALID_SESSION_ID", "sessionId must be a UUID", String(sessionId)),
      );
      return false;
    };

    switch (msg.type) {
      case "subscribe":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Subscribe is for browsers"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleSubscribe(conn, msg);
        return;
      case "unsubscribe":
        if (!requireUuid(msg.sessionId)) return;
        this.handleUnsubscribe(conn, msg);
        return;
      case "input":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Input is for browsers"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleInput(conn, msg);
        return;
      case "stop_session":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "stop_session is for browsers"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleStopSession(conn, msg);
        return;
      case "ack":
        // No-op in slim gateway: we persist every event synchronously.
        // The ack is informational — the browser's lastAckSeq is what matters on reconnect.
        return;
      case "session_claimed":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_claimed is for daemons"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleSessionClaimed(conn, msg);
        return;
      case "session_event":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_event is for daemons"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleSessionEvent(conn, msg);
        return;
      case "session_status":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_status is for daemons"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleSessionStatus(conn, msg);
        return;
      case "subscribe_workspace":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "subscribe_workspace is for browsers"));
          return;
        }
        await this.handleSubscribeWorkspace(conn, msg as ClientSubscribeWorkspace);
        return;
      case "unsubscribe_workspace":
        conn.workspaceSubscribed = false;
        conn.workspaceStatusFilter = undefined;
        return;
    }
  }

  // ── Hello / auth ───────────────────────────────────────────────────

  private async handleHello(conn: Connection, hello: ClientHello): Promise<void> {
    conn.clientId = hello.clientId;

    if (hello.deviceType === "daemon") {
      if (!hello.workspaceId) {
        this.send(conn, createError("AUTH_FAILED", "Daemon hello missing workspaceId", undefined, false));
        conn.ws.close();
        return;
      }
      const userId = await this.cfg.validateDaemonAuth(hello.token, hello.workspaceId);
      if (!userId) {
        this.send(conn, createError("AUTH_FAILED", "Invalid daemon credentials", undefined, false));
        conn.ws.close();
        return;
      }
      conn.kind = "daemon";
      conn.userId = userId;
      conn.workspaceId = hello.workspaceId;
      conn.hostSnapshot = hello.hostSnapshot;

      // If another daemon was registered for this workspace, boot it.
      const existing = this.daemonByWorkspace.get(hello.workspaceId);
      if (existing && existing !== conn) {
        console.log(`[Relay] SUPERSEDING daemon ${existing.id} (clientId=${existing.clientId}) for workspace ${hello.workspaceId} — new daemon ${conn.id} (clientId=${hello.clientId})`);
        this.send(existing, createError("SUPERSEDED", "Another daemon connected for this workspace", undefined, false));
        existing.ws.close();
      } else {
        console.log(`[Relay] Daemon registered: ${conn.id} (clientId=${hello.clientId}) for workspace ${hello.workspaceId}`);
      }
      this.daemonByWorkspace.set(hello.workspaceId, conn);

      // Update workspace heartbeat so the UI shows the node as online
      await db
        .update(workspaces)
        .set({ lastHeartbeat: sql`now()` })
        .where(eq(workspaces.id, hello.workspaceId));
    } else {
      // Browser (or other client types default to browser auth)
      const userId = await this.cfg.validateBrowserToken(hello.token);
      if (!userId) {
        this.send(conn, createError("AUTH_FAILED", "Invalid or expired token", undefined, true));
        conn.ws.close();
        return;
      }
      conn.kind = "browser";
      conn.userId = userId;

      let userSet = this.clientsByUser.get(userId);
      if (!userSet) {
        userSet = new Set();
        this.clientsByUser.set(userId, userSet);
      }
      userSet.add(conn);
    }

    conn.heartbeatTimer = setInterval(() => {
      if (!conn.alive) {
        console.log(`[Relay] Dead connection detected: ${conn.id} (${conn.kind})`);
        conn.ws.terminate();
        return;
      }
      conn.alive = false;
      conn.ws.ping();
    }, this.cfg.heartbeatIntervalMs);

    this.send(conn, {
      type: "hello_ok",
      gatewayTime: new Date().toISOString(),
      heartbeatIntervalMs: this.cfg.heartbeatIntervalMs,
      userId: conn.userId!,
    });

    // Send pending sessions on daemon connect (recovery for offline daemon)
    if (conn.kind === "daemon") {
      const pending = await db.query.chatConversations.findMany({
        where: and(
          eq(chatConversations.status, "pending"),
          eq(chatConversations.userId, conn.userId!),
        ),
      });
      for (const session of pending) {
        const isPlanning = session.sessionType === "planning";

        // Enrich execution sessions with task context from work_items
        let description: string | undefined;
        let identifier: string | undefined;
        let branch: string | undefined;
        if (!isPlanning && session.workItemId) {
          const taskRun = await db.query.taskRuns.findFirst({
            where: eq(taskRuns.sessionId, session.id),
            columns: { branch: true, workItemIdentifierSnapshot: true },
          });
          const wi = await db.query.workItems.findFirst({
            where: eq(workItems.id, session.workItemId),
            columns: { description: true },
          });
          description = wi?.description ?? undefined;
          identifier = taskRun?.workItemIdentifierSnapshot ?? undefined;
          branch = taskRun?.branch ?? undefined;
        }

        const personaMetadata = (session as any).personaMetadata as Record<string, unknown> | null;

        this.send(conn, {
          type: "session_available",
          sessionId: session.id,
          workingDirectory: session.workingDirectory ?? "",
          agentType: session.agentType,
          title: session.title ?? undefined,
          sessionType: isPlanning ? "planning" : "execution",
          planningContext:
            isPlanning &&
            (session as any).planningWorkspaceId &&
            (session as any).planningProjectId
              ? ({
                  workspaceId: (session as any).planningWorkspaceId,
                  projectId: (session as any).planningProjectId,
                  projectName: (session as any).planningProjectName ?? "",
                  launchContext: (session as any).planningLaunchContext ?? undefined,
                } as any)
              : undefined,
          description,
          identifier,
          branch,
          personaId: (session as any).personaId ?? undefined,
          personaConfig: personaMetadata ? {
            model: typeof personaMetadata.model === "string" ? personaMetadata.model : undefined,
            systemPrompt: typeof personaMetadata.systemPrompt === "string" ? personaMetadata.systemPrompt : undefined,
            allowedTools: Array.isArray(personaMetadata.allowedTools) ? personaMetadata.allowedTools as string[] : undefined,
            autonomyLevel: typeof personaMetadata.autonomyLevel === "string" ? personaMetadata.autonomyLevel : undefined,
            metadata: typeof personaMetadata.metadata === "object" ? personaMetadata.metadata as Record<string, unknown> : undefined,
          } : undefined,
        });
      }
    }
  }

  // ── Browser subscribe ──────────────────────────────────────────────

  private async handleSubscribe(conn: Connection, sub: ClientSubscribe): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, sub.sessionId),
    });

    if (!session) {
      this.send(conn, createError("SESSION_NOT_FOUND", `Session ${sub.sessionId} not found`, sub.sessionId));
      return;
    }

    if (session.userId !== conn.userId) {
      this.send(conn, createError("ACCESS_DENIED", "Not authorized for this session", sub.sessionId));
      return;
    }

    // Register subscription
    let subs = this.subscribers.get(sub.sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sub.sessionId, subs);
    }
    subs.add(conn);
    conn.subscribedSessions.add(sub.sessionId);

    // Send subscribed confirmation
    this.send(conn, {
      type: "subscribed",
      sessionId: sub.sessionId,
      currentState: (session.status ?? "stopped") as SessionStatus,
      latestSeq: session.nextSeq - 1,
    });

    // Replay missed events
    if (sub.lastAckSeq < session.nextSeq - 1) {
      const events = await db.query.sessionEvents.findMany({
        where: and(
          eq(sessionEvents.sessionId, sub.sessionId),
          gt(sessionEvents.seq, sub.lastAckSeq),
        ),
        orderBy: asc(sessionEvents.seq),
        limit: REPLAY_LIMIT + 1,
      });

      const toReplay = events.slice(0, REPLAY_LIMIT);
      for (const event of toReplay) {
        this.send(conn, {
          type: "event",
          sessionId: event.sessionId,
          seq: event.seq,
          eventType: event.eventType as any,
          direction: event.direction as any,
          payload: event.payload,
          createdAt:
            (event.createdAt as unknown) instanceof Date
              ? (event.createdAt as unknown as Date).toISOString()
              : String(event.createdAt),
        });
      }

      if (events.length > REPLAY_LIMIT) {
        this.send(conn, {
          type: "replay_truncated",
          sessionId: sub.sessionId,
          oldestAvailableSeq: toReplay[toReplay.length - 1]?.seq ?? sub.lastAckSeq,
        });
      }
    }
  }

  private handleUnsubscribe(conn: Connection, unsub: ClientUnsubscribe): void {
    const subs = this.subscribers.get(unsub.sessionId);
    if (subs) {
      subs.delete(conn);
      if (subs.size === 0) this.subscribers.delete(unsub.sessionId);
    }
    conn.subscribedSessions.delete(unsub.sessionId);
    this.send(conn, { type: "unsubscribed", sessionId: unsub.sessionId });
  }

  // ── Browser input → daemon ─────────────────────────────────────────

  private async handleInput(conn: Connection, input: ClientInput): Promise<void> {
    // Load session + its workspace via repository join.
    // (worktrees doesn't carry workspaceId directly — the workspace lives on
    // the repository row, and chatConversations has repositoryId, so we join
    // chatConversations → repositories to get the session's workspace.)
    const rows = await db
      .select({
        sessionUserId: chatConversations.userId,
        workspaceId: repositories.workspaceId,
      })
      .from(chatConversations)
      .leftJoin(repositories, eq(repositories.id, chatConversations.repositoryId))
      .where(eq(chatConversations.id, input.sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.sessionUserId !== conn.userId) {
      this.send(conn, createError("SESSION_NOT_FOUND", "Session not found", input.sessionId));
      return;
    }

    // Look up the daemon for this session's workspace.
    // TODO(phase-2): sessions without a repository currently fall back to findDaemonForUser.
    //   Planning sessions often don't have a repository attached yet. When we add an explicit
    //   workspaceId column on chat_conversations this can be tightened.
    const daemon = row.workspaceId
      ? this.daemonByWorkspace.get(row.workspaceId) ?? null
      : this.findDaemonForUser(conn.userId!);

    if (!daemon) {
      this.send(
        conn,
        createError("DAEMON_OFFLINE", "No daemon online for this session", input.sessionId, true),
      );
      return;
    }

    this.send(daemon, {
      type: "event",
      sessionId: input.sessionId,
      seq: 0, // input events aren't persisted with a seq; daemon ignores seq field here
      eventType: "input",
      direction: "client",
      payload: { data: input.data, clientInputId: input.clientInputId },
      createdAt: new Date().toISOString(),
    });

    // Ack to the browser
    this.send(conn, {
      type: "input_ack",
      sessionId: input.sessionId,
      clientInputId: input.clientInputId,
      acceptedSeq: 0,
    });
  }

  private findDaemonForUser(userId: string): Connection | null {
    for (const daemon of this.daemonByWorkspace.values()) {
      if (daemon.userId === userId) return daemon;
    }
    return null;
  }

  // ── Stop a running session ─────────────────────────────────────────

  private async handleStopSession(conn: Connection, msg: ClientStopSession): Promise<void> {
    const result = await this.requestSessionStop(conn.userId!, msg.sessionId);
    if (result === "not_found") {
      this.send(conn, createError("SESSION_NOT_FOUND", "Session not found", msg.sessionId));
      return;
    }
    // Ack that the stop was accepted; the daemon's terminal session_status
    // report ("interrupted") is what finalizes state for all subscribers.
    this.send(conn, { type: "session_stopped", sessionId: msg.sessionId });
  }

  /**
   * Ask the daemon running this session to kill its agent process.
   * Shared by the browser `stop_session` frame and POST /internal/session-stop
   * (the tRPC session.stop path). When no daemon is reachable, the session is
   * finalized as "stopped" directly — there is nothing left to kill.
   */
  async requestSessionStop(
    userId: string,
    sessionId: string,
  ): Promise<"not_found" | { delivered: boolean }> {
    const rows = await db
      .select({
        sessionUserId: chatConversations.userId,
        workspaceId: repositories.workspaceId,
      })
      .from(chatConversations)
      .leftJoin(repositories, eq(repositories.id, chatConversations.repositoryId))
      .where(eq(chatConversations.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.sessionUserId !== userId) return "not_found";

    const activeStatuses = ["pending", "provisioning", "starting", "running", "idle"];
    const daemon = row.workspaceId
      ? this.daemonByWorkspace.get(row.workspaceId) ?? null
      : this.findDaemonForUser(userId);

    if (daemon) {
      await db
        .update(chatConversations)
        .set({ status: "stopping" })
        .where(
          and(
            eq(chatConversations.id, sessionId),
            inArray(chatConversations.status, activeStatuses),
          ),
        );
      this.send(daemon, { type: "session_stop", sessionId });
      console.log(`[Relay] Stop relayed to daemon for session ${sessionId}`);
      return { delivered: true };
    }

    await db
      .update(chatConversations)
      .set({ status: "stopped", claimedByGatewayId: null, leaseExpiresAt: null })
      .where(
        and(
          eq(chatConversations.id, sessionId),
          inArray(chatConversations.status, activeStatuses),
        ),
      );
    console.log(`[Relay] Stop for session ${sessionId}: no daemon online, marked stopped`);
    return { delivered: false };
  }

  // ── Daemon session_claimed ─────────────────────────────────────────

  private async handleSessionClaimed(conn: Connection, claim: ClientSessionClaimed): Promise<void> {
    // Update DB: mark session as claimed by this daemon's workspace.
    // For v1 we just update the status from "pending" to "starting".
    await db
      .update(chatConversations)
      .set({ status: "starting" })
      .where(
        and(
          eq(chatConversations.id, claim.sessionId),
          eq(chatConversations.userId, conn.userId!),
        ),
      );

    // Update associated task_run to "running" and work_item to "in_progress"
    const taskRun = await db.query.taskRuns.findFirst({
      where: eq(taskRuns.sessionId, claim.sessionId),
      columns: { id: true, workItemId: true },
    });
    if (taskRun) {
      await db
        .update(taskRuns)
        .set({ status: "running" })
        .where(eq(taskRuns.id, taskRun.id));

      if (taskRun.workItemId) {
        await db
          .update(workItems)
          .set({ status: "in_progress" })
          .where(eq(workItems.id, taskRun.workItemId));
      }
    }

    // Bridge: create agent_runs row for dashboard visibility
    if (conn.workspaceId) {
      const session = await db.query.chatConversations.findFirst({
        where: eq(chatConversations.id, claim.sessionId),
        columns: { id: true, title: true, agentType: true, workItemId: true, personaMetadata: true },
      });
      if (session) {
        // agent_runs.tenant_id is NOT NULL. Resolve (and self-heal) the
        // workspace's tenant instead of silently skipping the insert — a
        // tenant-less workspace used to drop every run from the dashboard.
        const tenantId = await this.resolveWorkspaceTenantId(conn.workspaceId);
        if (tenantId) {
          await db.insert(agentRuns).values({
            sessionId: session.id,
            workItemId: session.workItemId ?? session.title ?? session.id,
            workspaceId: conn.workspaceId,
            tenantId,
            agentType: session.agentType ?? "claude",
            agentConfig: (session as any).personaMetadata ?? undefined,
            status: "running",
            startedAt: sql`now()`,
          });
        } else {
          console.warn(
            `[Relay] Could not resolve a tenant for workspace ${conn.workspaceId}; ` +
              `agent run for session ${session.id} will NOT appear on the dashboard. ` +
              `Backfill workspaces.tenant_id for this workspace.`,
          );
        }
      }
    }
  }

  /**
   * Return the tenant id for a workspace, healing tenant-less workspaces.
   *
   * Older workspaces created through the UI had no tenant (workspace.create
   * didn't assign one), which meant agent_runs — gated on a NOT NULL tenant_id —
   * were never recorded. When we hit one, resolve the owner's tenant (or create
   * a personal tenant for them) and backfill workspaces.tenant_id so this only
   * happens once per workspace.
   */
  private async resolveWorkspaceTenantId(workspaceId: string): Promise<string | null> {
    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { tenantId: true, ownerUserId: true },
    });
    if (!workspace) return null;
    if (workspace.tenantId) return workspace.tenantId;

    const ownerUserId = workspace.ownerUserId;
    if (!ownerUserId) return null;

    // Prefer an existing tenant the owner already belongs to.
    let tenantId: string | null = null;
    const existing = await db.query.tenantMembers.findFirst({
      where: eq(tenantMembers.userId, ownerUserId),
      columns: { tenantId: true },
    });
    tenantId = existing?.tenantId ?? null;

    // Otherwise create a personal tenant for the owner.
    if (!tenantId) {
      const slug = ownerUserId.replace(/[^a-z0-9-]/g, "-").slice(0, 64);
      try {
        const [tenant] = await db
          .insert(tenants)
          .values({ name: slug, slug, plan: "free" })
          .onConflictDoNothing()
          .returning({ id: tenants.id });
        if (tenant) {
          tenantId = tenant.id;
          await db
            .insert(tenantMembers)
            .values({ tenantId: tenant.id, userId: ownerUserId, role: "owner" })
            .onConflictDoNothing();
        }
      } catch (err) {
        console.warn(`[Relay] Tenant creation failed for workspace ${workspaceId}:`, err);
      }
      if (!tenantId) {
        const after = await db.query.tenantMembers.findFirst({
          where: eq(tenantMembers.userId, ownerUserId),
          columns: { tenantId: true },
        });
        tenantId = after?.tenantId ?? null;
      }
    }

    if (tenantId) {
      // Backfill so future claims skip all of the above.
      await db
        .update(workspaces)
        .set({ tenantId })
        .where(eq(workspaces.id, workspaceId));
    }

    return tenantId;
  }

  // ── Daemon session_event → persist + fan out ───────────────────────

  private async handleSessionEvent(conn: Connection, event: ClientSessionEvent): Promise<void> {
    // Atomic increment with RETURNING — fuses the auth check into the WHERE clause
    // and avoids the read-then-write race that caused duplicate seq values under burst.
    const updated = await db
      .update(chatConversations)
      .set({
        nextSeq: sql`${chatConversations.nextSeq} + 1`,
        lastActivityAt: sql`now()`,
      })
      .where(
        and(
          eq(chatConversations.id, event.sessionId),
          eq(chatConversations.userId, conn.userId!),
        ),
      )
      .returning({ newNextSeq: chatConversations.nextSeq });

    if (updated.length === 0) {
      this.send(
        conn,
        createError("ACCESS_DENIED", "Cannot emit events for this session", event.sessionId),
      );
      return;
    }

    // The returned value is AFTER increment, so the seq we use is (new - 1)
    const seq = updated[0]!.newNextSeq - 1;

    const record: SessionEventRecord = {
      sessionId: event.sessionId,
      seq,
      direction: event.direction,
      eventType: event.eventType,
      payload: event.payload,
    };

    await this.cfg.persistEvent(record);

    // Fan out to all subscribers of this session
    const subs = this.subscribers.get(event.sessionId);
    if (subs) {
      const forwarded: ServerMessage = {
        type: "event",
        sessionId: event.sessionId,
        seq,
        eventType: event.eventType,
        direction: event.direction,
        payload: event.payload,
        createdAt: new Date().toISOString(),
      };
      for (const sub of subs) {
        this.send(sub, forwarded);
      }
    }

    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, event.sessionId),
    });
    if (!session || session.userId !== conn.userId) return;

    const planningCounts = session.sessionType === "planning"
      ? (await this.getPlanningDraftCounts([session.id])).get(session.id) ?? {
          draftCount: 0,
          producedTaskCount: 0,
        }
      : {
          draftCount: undefined,
          producedTaskCount: undefined,
        };

    await this.broadcastWorkspaceSessionStatusChanged(
      conn.userId!,
      session,
      session.status as SessionStatus,
      planningCounts,
    );
    await this.broadcastWorkspaceInvalidation(
      conn.userId!,
      session,
      "session_event_appended",
    );
  }

  // ── Daemon session_status → update DB + notify subscribers ─────────

  private async handleSessionStatus(conn: Connection, msg: ClientSessionStatus): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, msg.sessionId),
    });
    if (!session || session.userId !== conn.userId) return;

    // Extract a human-readable failure reason from the daemon's summary so it
    // can be surfaced in the UI (chatConversations.lastError) rather than being
    // buried in an error session_event nobody renders.
    const summary = (msg as any).summary as
      | {
          code?: string;
          error?: string;
          reason?: string;
          message?: string;
          pullRequestUrl?: string;
          branch?: string;
          baseBranch?: string;
        }
      | undefined;
    const errorMessage =
      summary?.error ?? summary?.message ?? summary?.reason ?? undefined;
    const isError = msg.status === "error" || msg.status === "failed";

    await db
      .update(chatConversations)
      .set({
        status: msg.status,
        ...(isError && errorMessage
          ? {
              lastError: {
                code: summary?.code ?? "AGENT_ERROR",
                message: errorMessage,
                timestamp: new Date().toISOString(),
              },
            }
          : {}),
      })
      .where(eq(chatConversations.id, msg.sessionId));

    // Sync task_run and work_item status on terminal states. "error" is
    // terminal too (the runner emits it on an agent crash) — without it here,
    // a crashed run stayed stuck showing "running" in the UI forever.
    if (
      msg.status === "completed" ||
      msg.status === "failed" ||
      msg.status === "error" ||
      msg.status === "interrupted"
    ) {
      // task_runs / work_items don't have an "error" status in their enum —
      // map it to "failed" so the downstream writes satisfy the constraint.
      const runStatus = msg.status === "error" ? "failed" : msg.status;
      const taskRun = await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, msg.sessionId),
        columns: { id: true, workItemId: true },
      });
      if (taskRun) {
        // Record the PR (opened on the git host by the runner) in bob's own
        // tracking so it's visible in the UI, and link it to the task run.
        // Gateway-dispatched work (the autonomous driver + manual starts) goes
        // through this path, which previously left pull_requests empty.
        let pullRequestId: string | undefined;
        if (msg.status === "completed" && summary?.pullRequestUrl) {
          pullRequestId = await this.recordPullRequest(
            session,
            summary.pullRequestUrl,
            summary.branch,
            summary.baseBranch,
          ).catch((err) => {
            console.error("[Relay] Failed to record PR:", err);
            return undefined;
          });
        }

        await db
          .update(taskRuns)
          .set({
            status: runStatus,
            ...(isError && errorMessage ? { blockedReason: errorMessage } : {}),
            ...(pullRequestId ? { pullRequestId } : {}),
            completedAt: sql`now()`,
          })
          .where(eq(taskRuns.id, taskRun.id));

        if (taskRun.workItemId) {
          await db
            .update(workItems)
            .set({ status: msg.status === "completed" ? "in_review" : "ready" })
            .where(eq(workItems.id, taskRun.workItemId));
        }
      }

      // Bridge: update agent_runs for dashboard
      await db
        .update(agentRuns)
        .set({
          status: runStatus,
          completedAt: sql`now()`,
          summary: summary ?? { status: msg.status },
        })
        .where(eq(agentRuns.sessionId, msg.sessionId));

      // Bridge: write activity for work-item-linked sessions
      if (session.workItemId) {
        await db.insert(activities).values({
          workItemId: session.workItemId,
          userId: session.userId,
          type: "status_changed",
          fromValue: "running",
          toValue: msg.status,
          metadata: {
            sessionId: msg.sessionId,
            agentType: session.agentType,
            ...(errorMessage ? { error: errorMessage } : {}),
          },
        });
      }

      // Push: notify the user's mobile devices that the run finished. Fire and
      // forget — a push failure must never affect status handling.
      void this.notifyTerminalPush(session, msg.status, errorMessage, summary);
    }
    const planningCounts = session.sessionType === "planning"
      ? (await this.getPlanningDraftCounts([session.id])).get(session.id) ?? {
          draftCount: 0,
          producedTaskCount: 0,
        }
      : {
          draftCount: undefined,
          producedTaskCount: undefined,
        };

    const subs = this.subscribers.get(msg.sessionId);
    if (subs) {
      for (const sub of subs) {
        this.send(sub, {
          type: "session_status_changed",
          sessionId: msg.sessionId,
          status: msg.status,
          title: session.title ?? undefined,
          agentType: session.agentType,
          sessionType: session.sessionType,
          workItemId: session.workItemId ?? undefined,
          workItemIdentifier: session.workItemIdentifierSnapshot ?? undefined,
          draftCount: planningCounts.draftCount,
          producedTaskCount: planningCounts.producedTaskCount,
        });
      }
    }

    await this.broadcastWorkspaceSessionStatusChanged(
      conn.userId!,
      session,
      msg.status,
      planningCounts,
    );
  }

  /**
   * Record a PR (already opened on the git host by the runner) in bob's
   * pull_requests table and return its id, so gateway-dispatched work shows up
   * in the UI. Idempotent on the PR url. Best-effort: returns undefined if the
   * url can't be parsed or the row can't be written.
   */
  private async recordPullRequest(
    session: {
      id: string;
      userId: string;
      title?: string | null;
      repositoryId?: string | null;
      workItemIdentifierSnapshot?: string | null;
    },
    url: string,
    branch?: string,
    baseBranch?: string,
  ): Promise<string | undefined> {
    const parsed = parsePrUrl(url);
    if (!parsed) return undefined;
    const { host, owner, repo, number, provider } = parsed;

    const existing = await db.query.pullRequests.findFirst({
      where: eq(pullRequests.url, url),
      columns: { id: true },
    });
    if (existing) return existing.id;

    const [row] = await db
      .insert(pullRequests)
      .values({
        userId: session.userId,
        repositoryId: session.repositoryId ?? null,
        provider,
        instanceUrl: provider === "github" ? null : `https://${host}`,
        remoteOwner: owner,
        remoteName: repo,
        number,
        headBranch: branch ?? `pr-${number}`,
        baseBranch: baseBranch ?? "main",
        title: session.title ?? `PR #${number}`,
        status: "open",
        url,
        sessionId: session.id,
        planningTaskId: session.workItemIdentifierSnapshot ?? null,
      })
      .returning({ id: pullRequests.id });
    return row?.id;
  }

  /**
   * Push a "run finished" notification to the session owner's mobile devices.
   * Completed → success (PR link if any); error/failed → the failure reason;
   * interrupted → a stopped note. Planning sessions are skipped (they're
   * short and interactive). Best-effort — never throws into the caller.
   */
  private async notifyTerminalPush(
    session: {
      id: string;
      userId: string;
      title?: string | null;
      sessionType?: string | null;
      workItemId?: string | null;
      workItemIdentifierSnapshot?: string | null;
    },
    status: SessionStatus,
    errorMessage: string | undefined,
    summary: { pullRequestUrl?: string } | undefined,
  ): Promise<void> {
    if (session.sessionType === "planning") return;

    const label =
      session.workItemIdentifierSnapshot ?? session.title ?? "Your agent task";

    // Tap target: the mobile handler routes on workItemId (→ work item) and
    // falls back to `url`. Include both so a tap always lands somewhere useful.
    const routing = {
      workItemId: session.workItemId ?? undefined,
      sessionId: session.id,
      url: session.workItemId ? undefined : `/chat?session=${session.id}`,
    };

    let notification: Parameters<typeof pushToUser>[1] | null = null;
    if (status === "completed") {
      notification = {
        title: `${label} completed`,
        body: summary?.pullRequestUrl
          ? "Pull request is ready for review."
          : "The agent finished the task.",
        data: {
          type: "task.completed",
          pullRequestUrl: summary?.pullRequestUrl,
          ...routing,
        },
        channelId: "tasks",
        priority: "high",
      };
    } else if (status === "error" || status === "failed") {
      notification = {
        title: `${label} failed`,
        body: errorMessage ? errorMessage.slice(0, 140) : "The agent run failed.",
        data: { type: "session.error", ...routing },
        channelId: "tasks",
        priority: "high",
      };
    } else if (status === "interrupted") {
      notification = {
        title: `${label} stopped`,
        body: "The agent run was interrupted.",
        data: { type: "session.interrupted", ...routing },
        channelId: "tasks",
        priority: "default",
      };
    }

    if (!notification) return;
    await pushToUser(session.userId, notification).catch((err) =>
      console.error("[push] notifyTerminalPush failed:", err),
    );
  }

  private async broadcastWorkspaceSessionStatusChanged(
    userId: string,
    session: any,
    status: SessionStatus,
    planningCounts: { draftCount?: number; producedTaskCount?: number },
  ): Promise<void> {
    const userConns = this.clientsByUser.get(userId);
    if (!userConns) return;

    for (const c of userConns) {
      if (!c.workspaceSubscribed) continue;
      if (c.workspaceStatusFilter?.length && !c.workspaceStatusFilter.includes(status)) continue;
      if (c.workspaceScopeId) {
        const [matchingSession] = await this.filterSessionsByWorkspace([session], c.workspaceScopeId);
        if (!matchingSession) continue;
      }
      this.send(c, {
        type: "session_status_changed",
        sessionId: session.id,
        status,
        title: session.title ?? undefined,
        agentType: session.agentType,
        sessionType: session.sessionType,
        workItemId: session.workItemId ?? undefined,
        workItemIdentifier: session.workItemIdentifierSnapshot ?? undefined,
        draftCount: planningCounts.draftCount,
        producedTaskCount: planningCounts.producedTaskCount,
      });
    }
  }

  private broadcastWorkspaceIdInvalidation(
    workspaceId: string,
    type: ServerWorkspaceInvalidationType,
    entityId?: string,
    payload?: Record<string, unknown>,
  ): void {
    for (const c of this.connections.values()) {
      if (c.kind !== "browser") continue;
      if (!c.workspaceSubscribed) continue;
      if (c.workspaceScopeId && c.workspaceScopeId !== workspaceId) continue;
      this.send(c, {
        type,
        workspaceId,
        entityId,
        createdAt: new Date().toISOString(),
        payload,
      });
    }
  }

  private async broadcastWorkspaceInvalidation(
    userId: string,
    session: any,
    type: ServerWorkspaceInvalidationType,
  ): Promise<void> {
    const userConns = this.clientsByUser.get(userId);
    if (!userConns) return;

    for (const c of userConns) {
      if (!c.workspaceSubscribed) continue;
      if (
        c.workspaceStatusFilter?.length &&
        !c.workspaceStatusFilter.includes(session.status as SessionStatus)
      ) {
        continue;
      }
      if (c.workspaceScopeId) {
        const [matchingSession] = await this.filterSessionsByWorkspace([session], c.workspaceScopeId);
        if (!matchingSession) continue;
      }
      this.send(c, {
        type,
        workspaceId: c.workspaceScopeId,
        entityId: session.id,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ── Workspace subscription ────────────────────────────────────────

  private async handleSubscribeWorkspace(conn: Connection, msg: ClientSubscribeWorkspace): Promise<void> {
    conn.workspaceSubscribed = true;
    conn.workspaceScopeId = msg.workspaceId;
    conn.workspaceStatusFilter = msg.statusFilter;

    let rows = await db.query.chatConversations.findMany({
      where: eq(chatConversations.userId, conn.userId!),
      orderBy: [desc(chatConversations.lastActivityAt)],
      limit: 200,
    });
    rows = await this.filterSessionsByWorkspace(rows, msg.workspaceId);
    const planningSessionIds = rows
      .filter((row) => row.sessionType === "planning")
      .map((row) => row.id);
    const countsBySession = await this.getPlanningDraftCounts(planningSessionIds);

    let sessions = rows.map((row) => ({
      sessionId: row.id,
      status: row.status as SessionStatus,
      agentType: row.agentType,
      sessionType: row.sessionType,
      title: row.title ?? undefined,
      lastActivityAt: row.lastActivityAt ?? new Date().toISOString(),
      workItemId: row.workItemId ?? undefined,
      workItemIdentifier: row.workItemIdentifierSnapshot ?? undefined,
      draftCount: countsBySession.get(row.id)?.draftCount ?? 0,
      producedTaskCount: countsBySession.get(row.id)?.producedTaskCount ?? 0,
    }));

    if (msg.statusFilter?.length) {
      sessions = sessions.filter((s) => msg.statusFilter!.includes(s.status));
    }

    this.send(conn, { type: "workspace_snapshot", sessions });
    if (msg.workspaceId) {
      const daemon = this.daemonByWorkspace.get(msg.workspaceId);
      if (daemon?.hostSnapshot) {
        this.send(conn, {
          type: "host_snapshot",
          workspaceId: msg.workspaceId,
          snapshot: daemon.hostSnapshot,
        });
      }
    }
  }

  private broadcastHostSnapshot(workspaceId: string, snapshot: HostSnapshotWire): void {
    for (const conn of this.connections.values()) {
      if (
        conn.kind === "browser" &&
        conn.workspaceSubscribed &&
        conn.workspaceScopeId === workspaceId
      ) {
        this.send(conn, { type: "host_snapshot", workspaceId, snapshot });
      }
    }
  }

  private async getPlanningDraftCounts(
    planningSessionIds: string[],
  ): Promise<Map<string, { draftCount: number; producedTaskCount: number }>> {
    const drafts = planningSessionIds.length > 0
      ? await db.query.planDrafts.findMany({
          where: inArray(planDrafts.sessionId, planningSessionIds),
          columns: { id: true, sessionId: true, status: true },
        })
      : [];
    const countsBySession = new Map<string, { draftCount: number; producedTaskCount: number }>();

    for (const draft of drafts as Array<{ sessionId: string; status: string }>) {
      const counts = countsBySession.get(draft.sessionId) ?? {
        draftCount: 0,
        producedTaskCount: 0,
      };
      if (draft.status === "committed") {
        counts.producedTaskCount += 1;
      } else if (draft.status === "draft") {
        counts.draftCount += 1;
      }
      countsBySession.set(draft.sessionId, counts);
    }

    return countsBySession;
  }

  private async filterSessionsByWorkspace(rows: any[], workspaceId?: string): Promise<any[]> {
    if (!workspaceId) return rows;

    const repositoryIds = rows
      .map((row) => row.repositoryId)
      .filter((value): value is string => typeof value === "string");
    const workItemIds = rows
      .map((row) => row.workItemId)
      .filter((value): value is string => typeof value === "string");

    const repositoryRows = repositoryIds.length > 0
      ? await db.query.repositories.findMany({
          where: inArray(repositories.id, repositoryIds),
          columns: { id: true, workspaceId: true },
        })
      : [];
    const workItemRows = workItemIds.length > 0
      ? await db.query.workItems.findMany({
          where: inArray(workItems.id, workItemIds),
          columns: { id: true, workspaceId: true },
        })
      : [];

    const repositoryWorkspaces = new Map(
      repositoryRows.map((row: any) => [row.id, row.workspaceId]),
    );
    const workItemWorkspaces = new Map(
      workItemRows.map((row: any) => [row.id, row.workspaceId]),
    );

    return rows.filter((row) => {
      if (row.planningWorkspaceId === workspaceId) return true;
      if (row.repositoryId && repositoryWorkspaces.get(row.repositoryId) === workspaceId) return true;
      if (row.workItemId && workItemWorkspaces.get(row.workItemId) === workspaceId) return true;
      return false;
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  private cleanupConnection(conn: Connection): void {
    if (conn.heartbeatTimer) {
      clearInterval(conn.heartbeatTimer);
      conn.heartbeatTimer = null;
    }

    // Remove from subscribers
    for (const sessionId of conn.subscribedSessions) {
      const subs = this.subscribers.get(sessionId);
      if (subs) {
        subs.delete(conn);
        if (subs.size === 0) this.subscribers.delete(sessionId);
      }
    }

    // Remove from user clients
    if (conn.kind === "browser" && conn.userId) {
      const userSet = this.clientsByUser.get(conn.userId);
      if (userSet) {
        userSet.delete(conn);
        if (userSet.size === 0) this.clientsByUser.delete(conn.userId);
      }
    }

    // Remove from daemon map
    if (conn.kind === "daemon" && conn.workspaceId) {
      const current = this.daemonByWorkspace.get(conn.workspaceId);
      if (current === conn) {
        this.daemonByWorkspace.delete(conn.workspaceId);
      }
    }

    this.connections.delete(conn.id);
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.ws.readyState !== 1 /* OPEN */) return;
    conn.ws.send(encodeServerMessage(msg));
  }
}
