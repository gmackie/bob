import type { WebSocket } from "ws";
import { eq, and, or, gt, lt, inArray, asc, desc, sql, isNull } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, repositories, sessionEvents, taskRuns, workItems, agentRuns, activities, workspaces, tenants, tenantMembers, planDrafts, pullRequests, runnerLeases, gatewayConfig, eventLog } from "@bob/db/schema";

import {
  parseClientMessage,
  encodeServerMessage,
  createError,
  type ClientMessage,
  type ClientHello,
  type ClientSubscribe,
  type ClientUnsubscribe,
  type ClientInput,
  type ClientApprove,
  type ClientStopSession,
  type ClientSessionEvent,
  type ClientSessionStatus,
  type ClientSessionClaimed,
  type ClientSubscribeWorkspace,
  type ServerMessage,
  type ServerWorkspaceInvalidationType,
  type SessionStatus,
} from "./protocol.js";
import type { SessionEventRecord } from "./persistence.js";
import { pushToUser } from "./push.js";
import { enqueueTransition } from "./outbox.js";
import { parsePrUrl } from "./pr-url.js";

const REPLAY_LIMIT = 500;

// Single source of truth for status-set membership so the state machine, lease
// sweep, and stop path can't drift (they previously encoded these inline and
// disagreed — e.g. stop didn't know about "blocked"/"host_unknown").
// A terminal state can never be downgraded and is never swept.
const TERMINAL_STATUSES = ["completed", "failed", "error", "interrupted", "stopped"] as const;
// Statuses the lease sweep may move to host_unknown on contact loss.
const SWEEP_ACTIVE_STATUSES = ["running", "starting", "blocked", "stopping"] as const;
// Non-terminal statuses a user stop can act on. Includes the paused/lost states
// so a blocked or host_unknown run can actually be stopped (otherwise it pins
// forever while the UI reports the stop succeeded).
const STOPPABLE_STATUSES = [
  "pending",
  "provisioning",
  "starting",
  "running",
  "idle",
  "blocked",
  "host_unknown",
  "stopping",
] as const;

// Orphan reaper: a run stuck in an active status (queued/running) with NO
// session for longer than this has never been claimed (a real claim attaches a
// session at once) — a crashed dispatch, a retired daemon, or an ancient dev
// artifact. 60 min is far beyond the seconds a dispatch→claim actually takes,
// so legitimate just-dispatched runs are never touched. Runs WITH a session are
// the lease sweep's domain (host_unknown), never the reaper's.
const REAP_ORPHAN_GRACE_MS = 60 * 60_000;
const REAP_INTERVAL_MS = 5 * 60_000;

// How often the gateway pushes newly-pending sessions to connected daemons.
// 15s keeps dispatch→run latency low while the DB scan stays cheap (one indexed
// query per connected daemon). This is the reliable dispatch path — the CF
// Worker cannot reach /internal/nudge over HTTP post-supersession.
const PENDING_DELIVERY_INTERVAL_MS = 15_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

interface Connection {
  id: string;
  ws: WebSocket;
  kind: "browser" | "daemon" | "unauth";
  userId: string | null;
  workspaceId: string | null; // set for daemon
  hostId: string | null; // set for daemon (runner lease identity)
  clientId: string;
  subscribedSessions: Set<string>;
  heartbeatTimer: NodeJS.Timeout | null;
  alive: boolean;
  workspaceSubscribed: boolean;
  workspaceScopeId?: string;
  workspaceStatusFilter?: SessionStatus[];
  // Daemon only: sessionIds already delivered via session_available on this
  // connection, so the periodic pending-delivery tick doesn't re-send (and
  // trigger a double-claim) for a session already handed over.
  deliveredSessions?: Set<string>;
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
  private reapTimer: NodeJS.Timeout | null = null;
  private pendingDeliveryTimer: NodeJS.Timeout | null = null;

  constructor(cfg: RelayConfig) {
    this.cfg = cfg;
    this.timeoutSweepTimer = setInterval(() => {
      this.sweepExpiredLeases().catch((err) => {
        console.error("[Relay] Lease sweep failed (will retry next interval):", err);
      });
    }, 15_000);
    this.reapTimer = setInterval(() => {
      this.reapOrphanedRuns().catch((err) => {
        console.error("[Relay] Orphan reaper failed (will retry next interval):", err);
      });
    }, REAP_INTERVAL_MS);
    this.pendingDeliveryTimer = setInterval(() => {
      this.deliverPendingTick().catch((err) => {
        console.error("[Relay] Pending-session delivery failed (will retry next interval):", err);
      });
    }, PENDING_DELIVERY_INTERVAL_MS);
  }

  /**
   * Reap orphaned agent runs — the self-healing companion to the one-time
   * manual cleanup. A run in queued/running with a NULL session_id past the
   * grace period was never claimed by any runner (a claim attaches a session
   * immediately), so it is provably dead: terminalize it so it stops showing as
   * "active"/"running" in every pipeline view and count. `running` → interrupted
   * (it purported to be executing), `queued` → failed (it never started). Runs
   * WITH a session are untouched here — those are the lease sweep's job.
   */
  private async reapOrphanedRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - REAP_ORPHAN_GRACE_MS).toISOString();
    const reaped = await db
      .update(agentRuns)
      .set({
        status: sql`case when ${agentRuns.status} = 'running' then 'interrupted'::agent_run_status else 'failed'::agent_run_status end`,
        completedAt: new Date(),
        summary: sql`(coalesce(${agentRuns.summary}::jsonb, '{}'::jsonb) || jsonb_build_object('reaped', true, 'reap_reason', 'orphaned: active status with no session past grace'))::json`,
      })
      .where(
        and(
          inArray(agentRuns.status, ["queued", "running"]),
          isNull(agentRuns.sessionId),
          lt(agentRuns.createdAt, cutoff),
        ),
      )
      .returning({ id: agentRuns.id });
    if (reaped.length > 0) {
      console.log(
        `[Relay] Reaped ${reaped.length} orphaned run(s): active status with no session past grace`,
      );
    }
  }

  /**
   * Lease sweep — the run-level inactivity timeout is GONE. Silence never
   * means failure: the old 35-minute sweep marked long-quiet runs
   * failed/timeout, which is the exact false-death class the trust work
   * eliminates (a 40-minute compile inside a tool call is healthy). Liveness
   * now belongs to the runner lease: only a lease whose heartbeat is older
   * than the grace period moves that workspace's active sessions to
   * host_unknown — "lost contact, fate unknown", never "failed".
   */
  private async sweepExpiredLeases(): Promise<void> {
    const cfg = await db.query.gatewayConfig
      .findFirst()
      .catch(() => null as { leaseGraceMs: number } | null);
    const graceMs = cfg?.leaseGraceMs ?? 60_000;
    const cutoff = new Date(Date.now() - graceMs).toISOString();

    const expired = await db.query.runnerLeases.findMany({
      where: lt(runnerLeases.lastHeartbeatAt, cutoff),
    });

    for (const lease of expired) {
      // A live daemon connection for the workspace overrides a stale lease
      // row (belt over suspenders — its pings should have kept it fresh).
      if (this.daemonByWorkspace.has(lease.workspaceId)) continue;

      const sessions = await db
        .select({
          id: chatConversations.id,
          userId: chatConversations.userId,
          workItemId: chatConversations.workItemId,
          agentType: chatConversations.agentType,
        })
        .from(chatConversations)
        .leftJoin(repositories, eq(repositories.id, chatConversations.repositoryId))
        .where(
          and(
            inArray(chatConversations.status, [...SWEEP_ACTIVE_STATUSES]),
            // Resolve the session's workspace by repo OR by planning workspace,
            // so repo-less (ad-hoc/planning) sessions on a dead runner are not
            // stranded "running" forever (the old inactivity sweep that used to
            // catch them was deleted).
            or(
              eq(repositories.workspaceId, lease.workspaceId),
              eq(chatConversations.planningWorkspaceId, lease.workspaceId),
            ),
          ),
        );

      // Delete the expired lease AFTER resolving its sessions: a permanently
      // expired row must not be re-selected every 15s (that, plus the
      // same-state no-op above, is what stopped the infinite sweep churn). A
      // returning runner re-creates its lease via the hello upsert.
      await db.delete(runnerLeases).where(eq(runnerLeases.id, lease.id));

      for (const session of sessions) {
        const result = await this.deriveAndWriteState(session.id, "host_unknown");
        if (!result.applied) continue;
        console.log(
          `[Relay] Lease expired for workspace ${lease.workspaceId} (host ${lease.hostId}): session ${session.id} → host_unknown`,
        );
        await db
          .update(agentRuns)
          .set({ status: "host_unknown" })
          .where(eq(agentRuns.sessionId, session.id));

        // Distinct copy and severity: lost contact is NOT a death notice.
        // reArmOnConflict: gateway-originated transitions all use sourceSendSeq
        // -1, so the occurrence-unique key would suppress EVERY later
        // host_unknown for this session's lifetime. Re-arm a prior, already
        // resolved/seen alarm so a SECOND lost-contact (after recovery) still
        // notifies — the exact trust defect the 10-run gate resets on.
        // Best-effort here (enqueueTransition rethrows for the ack-gating
        // status path): a failed push for one session must not abort the sweep
        // for the rest. The next tick re-derives owed host_unknown pushes.
        try {
          await enqueueTransition({
            sessionId: session.id,
            userId: session.userId,
            transition: "host_unknown",
            sourceSendSeq: -1,
            reArmOnConflict: true,
            title: "Lost contact with host",
            body: `${lease.hostId}: contact lost — the run may still be going; not confirmed dead.`,
            data: {
              type: "session.host_unknown",
              sessionId: session.id,
              workItemId: session.workItemId ?? undefined,
              hostId: lease.hostId,
              transition: "host_unknown",
              sourceSendSeq: -1,
            },
            priority: "default",
          });
        } catch (err) {
          console.error(`[Relay] host_unknown enqueue failed for ${session.id}:`, err);
        }

        const subs = this.subscribers.get(session.id);
        if (subs) {
          for (const sub of subs) {
            this.send(sub, {
              type: "session_status_changed",
              sessionId: session.id,
              status: "host_unknown",
              agentType: session.agentType,
            });
          }
        }
      }
    }
  }

  /**
   * THE single writer for session status. Every status transition — daemon
   * reports, lease sweeps, reconciliation — funnels through here, inside a
   * per-row lock, with explicit precedence:
   *   - terminal states (completed/failed/error/interrupted/stopped) can
   *     never be downgraded to host_unknown;
   *   - a terminal state arriving AFTER host_unknown applies and is flagged
   *     corrective (the "lost contact" alarm gets retracted).
   * No other code path may write chatConversations.status.
   */
  private async deriveAndWriteState(
    sessionId: string,
    incoming: SessionStatus,
    extra?: Record<string, unknown>,
    onlyIfPrevIn?: string[],
  ): Promise<{ applied: boolean; previous: string | null; corrective: boolean }> {
    const TERMINAL: readonly string[] = TERMINAL_STATUSES;
    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({ status: chatConversations.status })
        .from(chatConversations)
        .where(eq(chatConversations.id, sessionId))
        .for("update");
      const previous = rows[0]?.status ?? null;
      if (previous === null) return { applied: false, previous, corrective: false };

      // Same-state write is a no-op. Without this the lease sweep re-applies
      // host_unknown -> host_unknown every 15s forever (unbounded churn on the
      // exhaustion-prone Postgres box), and a redelivered status frame would
      // re-run non-idempotent side effects (e.g. duplicate activity rows).
      if (previous === incoming) {
        return { applied: false, previous, corrective: false };
      }

      if (onlyIfPrevIn && !onlyIfPrevIn.includes(previous)) {
        return { applied: false, previous, corrective: false };
      }
      // A terminal state is FINAL — nothing overwrites it. This blocks a
      // replayed session_claimed ("starting"), an adopted "running", or a
      // second differing terminal from resurrecting or flipping a finished run
      // (previously only host_unknown was guarded, so any non-terminal could
      // stomp a terminal — silent corruption). The intended terminal-retracts-
      // host_unknown case still works: host_unknown is non-terminal, so a
      // terminal arriving on top of it passes this guard and is corrective.
      if (TERMINAL.includes(previous)) {
        return { applied: false, previous, corrective: false };
      }
      const corrective = previous === "host_unknown" && TERMINAL.includes(incoming);

      await tx
        .update(chatConversations)
        .set({ status: incoming, ...(extra ?? {}) })
        .where(eq(chatConversations.id, sessionId));
      return { applied: true, previous, corrective };
    });
  }

  handleConnection(ws: WebSocket): void {
    const id = `conn-${++this.nextConnId}`;
    const conn: Connection = {
      id,
      ws,
      kind: "unauth",
      userId: null,
      workspaceId: null,
      hostId: null,
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
        // Daemon pings double as liveness. The runner LEASE is the
        // authoritative signal (only the runner's own ping updates it);
        // workspaces.lastHeartbeat is kept fresh too for UI back-compat but
        // has other writers and must not be trusted for liveness.
        if (conn.kind === "daemon" && conn.workspaceId) {
          await db
            .update(runnerLeases)
            .set({ lastHeartbeatAt: sql`now()` })
            .where(
              and(
                eq(runnerLeases.workspaceId, conn.workspaceId),
                eq(runnerLeases.hostId, conn.hostId ?? "unknown"),
              ),
            )
            .catch(() => {});
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
      case "approve":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "approve is for browsers"));
          return;
        }
        if (!requireUuid(msg.sessionId)) return;
        await this.handleApprove(conn, msg);
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
      case "run_view": {
        // Explicit foreground run-screen visibility — the honest instrument
        // for the "not watching" acceptance proxy (WS subscribes don't
        // count: background clients subscribe automatically).
        const rv = msg as unknown as { sessionId?: string };
        if (conn.kind === "browser" && isUuid(rv.sessionId)) {
          this.audit(conn.userId!, "observe.run_view", { sessionId: rv.sessionId });
        }
        return;
      }
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
      conn.hostId = hello.hostId ?? "unknown";

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

      // Register/refresh the runner lease — the identity-backed liveness row
      // only this daemon's heartbeats may touch. connectorInstanceId changes
      // per runner start, letting adoption logic tell restart from reconnect.
      await db
        .insert(runnerLeases)
        .values({
          workspaceId: hello.workspaceId,
          hostId: conn.hostId ?? "unknown",
          connectorInstanceId: hello.connectorInstanceId ?? hello.clientId,
          daemonVersion: hello.daemonVersion,
        })
        .onConflictDoUpdate({
          target: [runnerLeases.workspaceId, runnerLeases.hostId],
          set: {
            connectorInstanceId: hello.connectorInstanceId ?? hello.clientId,
            daemonVersion: hello.daemonVersion,
            startedAt: sql`now()`,
            lastHeartbeatAt: sql`now()`,
          },
        })
        .catch((err) => {
          console.error("[Relay] runner lease upsert failed:", err);
        });

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
      await this.deliverPendingSessionsToDaemon(conn);
    }
  }

  /**
   * Push every pending session for the daemon's user as a session_available.
   * Called on daemon connect AND periodically (deliverPendingTick) — the
   * periodic call is what makes dispatch reliable now that the CF Worker cannot
   * reach the gateway's /internal/nudge over HTTP (ws.blder.bot serves only the
   * WS upgrade; a Worker-side nudge silently no-ops). Without a live nudge, a
   * session created while the daemon is already connected would otherwise sit
   * pending until the next reconnect. Per-connection dedup via
   * `deliveredSessions` avoids re-sending (and double-claiming) a session
   * already handed over; a claimed session leaves `status='pending'` so it also
   * naturally drops out of the query.
   */
  private async deliverPendingSessionsToDaemon(conn: Connection): Promise<void> {
    if (conn.kind !== "daemon" || !conn.userId) return;
    if (!conn.deliveredSessions) conn.deliveredSessions = new Set<string>();

    const pending = await db.query.chatConversations.findMany({
      where: and(
        eq(chatConversations.status, "pending"),
        eq(chatConversations.userId, conn.userId),
      ),
    });
    for (const session of pending) {
      if (conn.deliveredSessions.has(session.id)) continue;
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

      // Mark delivered BEFORE send so a send that races the next tick is not
      // double-emitted; a genuinely undelivered session (socket dead) will be
      // re-picked on the daemon's next connect via the same method.
      conn.deliveredSessions.add(session.id);
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

  /**
   * Periodic drain: push newly-pending sessions to each connected daemon. This
   * is the reliable path for auto-drain + manual dispatch — see
   * deliverPendingSessionsToDaemon for why the Worker nudge can't be relied on.
   */
  private async deliverPendingTick(): Promise<void> {
    for (const daemon of this.daemonByWorkspace.values()) {
      await this.deliverPendingSessionsToDaemon(daemon).catch((err) =>
        console.error("[Relay] pending-delivery failed for a daemon:", err),
      );
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
        const lastSentSeq = toReplay[toReplay.length - 1]?.seq ?? sub.lastAckSeq;
        this.send(conn, {
          type: "replay_truncated",
          sessionId: sub.sessionId,
          oldestAvailableSeq: lastSentSeq,
        });

        // Trust-critical: output replay is capped, but the events that drive
        // the approval banner and status MUST NOT be dropped. A permission
        // request that is the 501st+ event since lastAckSeq would otherwise be
        // invisible — opening its push deep-link would show no approve/deny
        // controls. Re-send the tail lifecycle events (past the truncation
        // point) so the client always reconstructs the current pending-approval
        // and status state, even when the chatty output between them was cut.
        const lifecycle = await db.query.sessionEvents.findMany({
          where: and(
            eq(sessionEvents.sessionId, sub.sessionId),
            gt(sessionEvents.seq, lastSentSeq),
            inArray(sessionEvents.eventType, [
              "permission_request",
              "permission_resolved",
              "status_change",
            ]),
          ),
          orderBy: asc(sessionEvents.seq),
          limit: REPLAY_LIMIT,
        });
        for (const event of lifecycle) {
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

    this.audit(conn.userId!, "control.input", { sessionId: input.sessionId });

    // Ack to the browser
    this.send(conn, {
      type: "input_ack",
      sessionId: input.sessionId,
      clientInputId: input.clientInputId,
      acceptedSeq: 0,
    });
  }

  // ── Audit ──────────────────────────────────────────────────────────

  /**
   * Audit trail on the control plane: every control action (stop, approve,
   * input) and every explicit run observation writes an event_log row —
   * user, action, session, timestamp. Observation events double as the
   * measurement instrument for the "not watching" acceptance proxy.
   * Best-effort: an audit failure must never block the action itself.
   */
  private audit(
    userId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    void db
      .insert(eventLog)
      .values({ userId, eventType, payload })
      .catch((err) => console.error(`[Relay] audit write failed (${eventType}):`, err));
  }

  // ── Browser approve → daemon ───────────────────────────────────────

  /**
   * Resolve a pending permission_request on a blocked run. Same ownership
   * and routing rules as input; the daemon enforces exactly-once resolution
   * per requestId, so a double-tapped approve is harmless.
   */
  private async handleApprove(conn: Connection, msg: ClientApprove): Promise<void> {
    // Validate the decision at the trust boundary (parseClientMessage does not).
    // Anything other than an explicit allow/deny is rejected rather than
    // forwarded — the runner defaults unknown decisions to deny, but a garbage
    // requestId/message should not reach the agent control channel unchecked.
    if (msg.decision !== "allow" && msg.decision !== "deny") {
      this.send(conn, createError("INVALID_MESSAGE", "decision must be allow or deny", msg.sessionId));
      return;
    }
    if (typeof msg.requestId !== "string" || msg.requestId.length === 0 || msg.requestId.length > 200) {
      this.send(conn, createError("INVALID_MESSAGE", "invalid requestId", msg.sessionId));
      return;
    }
    if (msg.message !== undefined && (typeof msg.message !== "string" || msg.message.length > 2000)) {
      this.send(conn, createError("INVALID_MESSAGE", "invalid message", msg.sessionId));
      return;
    }

    const rows = await db
      .select({
        sessionUserId: chatConversations.userId,
        workspaceId: repositories.workspaceId,
      })
      .from(chatConversations)
      .leftJoin(repositories, eq(repositories.id, chatConversations.repositoryId))
      .where(eq(chatConversations.id, msg.sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.sessionUserId !== conn.userId) {
      this.send(conn, createError("SESSION_NOT_FOUND", "Session not found", msg.sessionId));
      return;
    }

    const daemon = row.workspaceId
      ? this.daemonByWorkspace.get(row.workspaceId) ?? null
      : this.findDaemonForUser(conn.userId!);

    if (!daemon) {
      this.send(
        conn,
        createError("DAEMON_OFFLINE", "No daemon online for this session", msg.sessionId, true),
      );
      return;
    }

    this.send(daemon, {
      type: "event",
      sessionId: msg.sessionId,
      seq: 0,
      eventType: "approval" as never,
      direction: "client",
      payload: {
        requestId: msg.requestId,
        decision: msg.decision,
        ...(msg.message ? { message: msg.message } : {}),
        clientInputId: msg.clientInputId,
      },
      createdAt: new Date().toISOString(),
    });
    this.audit(conn.userId!, "control.approve", {
      sessionId: msg.sessionId,
      requestId: msg.requestId,
      decision: msg.decision,
    });

    this.send(conn, {
      type: "input_ack",
      sessionId: msg.sessionId,
      clientInputId: msg.clientInputId,
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

    // Includes blocked/host_unknown so a paused or lost run can actually be
    // stopped — otherwise the onlyIfPrevIn guard rejects the transition and the
    // session pins forever while the UI reports the stop succeeded.
    const activeStatuses = [...STOPPABLE_STATUSES];
    const daemon = row.workspaceId
      ? this.daemonByWorkspace.get(row.workspaceId) ?? null
      : this.findDaemonForUser(userId);

    if (daemon) {
      await this.deriveAndWriteState(sessionId, "stopping", undefined, activeStatuses);
      this.audit(userId, "control.stop", { sessionId });
      this.send(daemon, { type: "session_stop", sessionId });
      console.log(`[Relay] Stop relayed to daemon for session ${sessionId}`);
      return { delivered: true };
    }

    await this.deriveAndWriteState(
      sessionId,
      "stopped",
      { claimedByGatewayId: null, leaseExpiresAt: null },
      activeStatuses,
    );
    console.log(`[Relay] Stop for session ${sessionId}: no daemon online, marked stopped`);
    return { delivered: false };
  }

  // ── Daemon session_claimed ─────────────────────────────────────────

  private async handleSessionClaimed(conn: Connection, claim: ClientSessionClaimed): Promise<void> {
    // Ownership check, then the single-writer path (pending → starting).
    const owned = await db.query.chatConversations.findFirst({
      where: and(
        eq(chatConversations.id, claim.sessionId),
        eq(chatConversations.userId, conn.userId!),
      ),
      columns: { id: true },
    });
    if (!owned) return;

    // Idempotent claim: session_claimed is journaled with a send-seq and
    // replayed on reconnect, but (unlike event/status envelopes) the gateway
    // does not ack/dedup it. If this session already has an agent_runs row it
    // was already claimed, so a replay must NOT reset status to "starting" or
    // insert a duplicate dashboard row.
    const existingRun = await db.query.agentRuns.findFirst({
      where: eq(agentRuns.sessionId, claim.sessionId),
      columns: { id: true },
    });
    if (existingRun) return;

    await this.deriveAndWriteState(claim.sessionId, "starting");

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

  /**
   * Envelope-protocol ingest: transactionally persist a daemon frame keyed by
   * its runner send-seq, then ack. The transaction makes persist-then-ack
   * atomic — an ack is only ever sent for a committed row, so the runner can
   * safely truncate its disk journal on ack. Redelivery (the runner replaying
   * after a partition) is detected by the (sessionId, sendSeq) unique key and
   * acked without a second row or a second fan-out.
   */
  private async persistEnvelopeEvent(
    conn: Connection,
    sessionId: string,
    sendSeq: number,
    eventType: string,
    direction: string,
    payload: Record<string, unknown>,
  ): Promise<{ kind: "inserted"; seq: number } | { kind: "duplicate" } | { kind: "denied" }> {
    return await db.transaction(async (tx) => {
      // Duplicate check first so redelivery doesn't burn a gateway seq.
      const existing = await tx
        .select({ id: sessionEvents.id })
        .from(sessionEvents)
        .where(
          and(
            eq(sessionEvents.sessionId, sessionId),
            eq(sessionEvents.sendSeq, sendSeq),
          ),
        )
        .limit(1);
      if (existing.length > 0) return { kind: "duplicate" as const };

      const updated = await tx
        .update(chatConversations)
        .set({
          nextSeq: sql`${chatConversations.nextSeq} + 1`,
          lastActivityAt: sql`now()`,
        })
        .where(
          and(
            eq(chatConversations.id, sessionId),
            eq(chatConversations.userId, conn.userId!),
          ),
        )
        .returning({ newNextSeq: chatConversations.nextSeq });
      if (updated.length === 0) return { kind: "denied" as const };

      const seq = updated[0]!.newNextSeq - 1;
      // The unique index still guards a concurrent race on the same sendSeq:
      // the loser's insert aborts the transaction, the runner redelivers, and
      // the redelivery hits the duplicate check above.
      await tx.insert(sessionEvents).values({
        sessionId,
        seq,
        sendSeq,
        direction,
        eventType,
        payload,
      });
      return { kind: "inserted" as const, seq };
    });
  }

  private async handleSessionEvent(conn: Connection, event: ClientSessionEvent): Promise<void> {
    let seq: number;

    if (typeof event.sendSeq === "number") {
      // Envelope path: durable persist, then ack, then fan out.
      const result = await this.persistEnvelopeEvent(
        conn,
        event.sessionId,
        event.sendSeq,
        event.eventType,
        event.direction,
        event.payload,
      );
      if (result.kind === "denied") {
        this.send(
          conn,
          createError("ACCESS_DENIED", "Cannot emit events for this session", event.sessionId),
        );
        return;
      }
      this.send(conn, {
        type: "event_ack",
        sessionId: event.sessionId,
        sendSeq: event.sendSeq,
      });
      if (result.kind === "duplicate") return; // already persisted + fanned out
      seq = result.seq;
    } else {
      // Legacy (no sendSeq) path: batched writer, fire-and-forget durability.
      // Atomic increment with RETURNING — fuses the auth check into the WHERE
      // clause and avoids the read-then-write race that caused duplicate seq
      // values under burst.
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
      seq = updated[0]!.newNextSeq - 1;

      const record: SessionEventRecord = {
        sessionId: event.sessionId,
        seq,
        direction: event.direction,
        eventType: event.eventType,
        payload: event.payload,
      };

      await this.cfg.persistEvent(record);
    }

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
    if (typeof msg.sendSeq === "number") {
      // Envelope path: the status transition itself becomes a durable
      // status_change event row so completion can never be lost.
      //
      // Ordering is load-bearing: persist -> APPLY -> ack. The ack certifies
      // both durability AND that the side effects (status column, work-item
      // sync, terminal/blocked push) ran. If the gateway crashes or a DB error
      // throws between persist and apply, no ack is sent, so the runner
      // redelivers; the redelivered (duplicate) frame RE-RUNS applySessionStatus
      // (idempotent — deriveAndWriteState precedence + the outbox occurrence
      // key make re-application a no-op) instead of the old early-return that
      // permanently dropped the transition. Acking before applying was the bug.
      const result = await this.persistEnvelopeEvent(
        conn,
        msg.sessionId,
        msg.sendSeq,
        "status_change",
        "system",
        { status: msg.status, ...(msg.summary ? { summary: msg.summary } : {}) },
      );
      if (result.kind === "denied") {
        this.send(
          conn,
          createError("ACCESS_DENIED", "Cannot report status for this session", msg.sessionId),
        );
        return;
      }
      // Applies on both first delivery and redelivery. A throw here propagates
      // to the message-queue catch, which sends INTERNAL_ERROR and NO ack, so
      // the runner keeps the frame and redelivers.
      await this.applySessionStatus(conn, msg);
      this.send(conn, {
        type: "event_ack",
        sessionId: msg.sessionId,
        sendSeq: msg.sendSeq,
      });
      return;
    }
    await this.applySessionStatus(conn, msg);
  }

  /**
   * Side effects of a session status transition: status columns, task/work-item
   * mapping, PR recording, activity rows, terminal pushes, subscriber fan-out.
   * Runs exactly once per envelope occurrence (handleSessionStatus dedups).
   */
  private async applySessionStatus(
    conn: Connection,
    msg: {
      sessionId: string;
      status: SessionStatus;
      summary?: Record<string, unknown>;
      sendSeq?: number;
    },
  ): Promise<void> {
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

    const stateResult = await this.deriveAndWriteState(
      msg.sessionId,
      msg.status,
      isError && errorMessage
        ? {
            lastError: {
              code: summary?.code ?? "AGENT_ERROR",
              message: errorMessage,
              timestamp: new Date().toISOString(),
            },
          }
        : undefined,
    );
    // Tell a genuinely REJECTED transition (terminal-is-final / onlyIfPrevIn)
    // apart from a same-state REDELIVERY (previous === incoming). A rejection
    // gets no side effects. A same-state redelivery still needs to (re-)issue
    // the idempotent push intent below: a crash between the status commit and
    // the outbox enqueue on the FIRST pass would otherwise leave the ack unsent,
    // the runner redelivers, this pass no-ops the state write, and the owed
    // blocked/terminal notification would be permanently lost (no backstop row).
    const alreadyAtTarget = !stateResult.applied && stateResult.previous === msg.status;
    if (!stateResult.applied && !alreadyAtTarget) {
      return;
    }
    const freshlyApplied = stateResult.applied;

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

      // These status writes are all idempotent (SET status = terminal), so they
      // run on BOTH fresh apply and same-state redelivery — a crash between the
      // status commit and these writes would otherwise leave task_run/agent_run
      // stuck "running" while the conversation is terminal, never repaired.
      const taskRun = await db.query.taskRuns.findFirst({
        where: eq(taskRuns.sessionId, msg.sessionId),
        columns: { id: true, workItemId: true },
      });
      if (taskRun) {
        // Record the PR (opened on the git host by the runner) in bob's own
        // tracking so it's visible in the UI. recordPullRequest is idempotent
        // on the PR url.
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

      // Bridge: update agent_runs for dashboard (idempotent)
      await db
        .update(agentRuns)
        .set({
          status: runStatus,
          completedAt: sql`now()`,
          summary: summary ?? { status: msg.status },
        })
        .where(eq(agentRuns.sessionId, msg.sessionId));

      // Bridge: write activity for work-item-linked sessions. This INSERT is the
      // only non-idempotent write here, so it is the one thing gated on a fresh
      // apply — a redelivery must not append a duplicate activity row.
      if (freshlyApplied && session.workItemId) {
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

      // Push (via the outbox): record the send intent. Idempotent — the outbox
      // occurrence key (sessionId, transition, sourceSendSeq) dedups a redeliver
      // — so this ALWAYS runs (fresh apply OR same-state redelivery), closing
      // the crash-between-commit-and-enqueue window. When the session was
      // host_unknown, the terminal push doubles as the retraction of the
      // "lost contact" alarm.
      await this.enqueueTerminalNotification(
        session,
        runStatus as SessionStatus,
        errorMessage,
        summary,
        stateResult.corrective,
        msg.sendSeq ?? -1,
      );
    } else if (msg.status === "blocked") {
      // The wedge's marquee push: the run is paused on a human decision.
      const toolName =
        typeof msg.summary?.toolName === "string" ? msg.summary.toolName : undefined;
      const isReauth = msg.summary?.reason === "re-auth";
      await enqueueTransition({
        sessionId: msg.sessionId,
        userId: session.userId,
        transition: "blocked",
        sourceSendSeq: msg.sendSeq ?? -1,
        title: `${session.workItemIdentifierSnapshot ?? session.title ?? "Your agent task"} needs you`,
        body: isReauth
          ? "The agent hit an authentication problem and needs re-auth."
          : toolName
            ? `Approval requested: ${toolName}`
            : "The agent is waiting for your approval.",
        data: {
          type: "session.blocked",
          sessionId: msg.sessionId,
          workItemId: session.workItemId ?? undefined,
          transition: "blocked",
          sourceSendSeq: msg.sendSeq ?? -1,
          requestId: msg.summary?.requestId,
        },
        priority: "high",
      });
    }

    // A same-state redelivery only needed to (re)issue the idempotent push
    // intent above; the ephemeral subscriber fan-out already fired on the fresh
    // apply, so stop here (also avoids redundant broadcast queries).
    if (!freshlyApplied) return;

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
   * Record the "run finished" send intent in the outbox (the worker delivers
   * with retries). Completed → success (PR link if any); error/failed → the
   * failure reason; interrupted → a stopped note. Planning sessions are
   * skipped (they're short and interactive).
   */
  private async enqueueTerminalNotification(
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
    corrective: boolean,
    sourceSendSeq: number,
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

    // Corrective copy: contact was lost (host_unknown pushed earlier) but the
    // run actually finished — say so explicitly, retracting the alarm.
    const correctivePrefix = corrective ? "Contact restored — " : "";

    let notification: Parameters<typeof pushToUser>[1] | null = null;
    if (status === "completed") {
      notification = {
        title: `${label} completed`,
        body:
          correctivePrefix +
          (summary?.pullRequestUrl
            ? "Pull request is ready for review."
            : "The agent finished the task."),
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
        // Generic body: errorMessage is agent/tool-derived free text that can
        // contain secrets, tokens, paths, or stack traces, and a push body is
        // shown on the lock screen and passes through APNs/FCM. The detail is
        // kept in-app (chatConversations.lastError); the push just says to open.
        title: `${label} failed`,
        body: "The agent run failed — open to see details.",
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
    await enqueueTransition({
      sessionId: session.id,
      userId: session.userId,
      transition: status === "error" ? "failed" : status,
      sourceSendSeq,
      title: notification.title,
      body: notification.body,
      data: {
        ...(notification.data ?? {}),
        transition: status === "error" ? "failed" : status,
        sourceSendSeq,
      },
      channelId: notification.channelId,
      priority: notification.priority,
    });
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
