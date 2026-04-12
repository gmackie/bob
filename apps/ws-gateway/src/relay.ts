import type { WebSocket } from "ws";
import { eq, and, gt, asc, desc, sql } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, repositories, sessionEvents } from "@bob/db/schema";

import {
  parseClientMessage,
  encodeServerMessage,
  createError,
  type ClientMessage,
  type ClientHello,
  type ClientSubscribe,
  type ClientUnsubscribe,
  type ClientInput,
  type ClientSessionEvent,
  type ClientSessionStatus,
  type ClientSessionClaimed,
  type ClientSubscribeWorkspace,
  type ServerMessage,
  type SessionStatus,
} from "./protocol.js";
import type { SessionEventRecord } from "./persistence.js";

const REPLAY_LIMIT = 500;

interface Connection {
  id: string;
  ws: WebSocket;
  kind: "browser" | "daemon" | "unauth";
  userId: string | null;
  workspaceId: string | null; // set for daemon
  clientId: string;
  subscribedSessions: Set<string>;
  heartbeatTimer: NodeJS.Timeout | null;
  workspaceSubscribed: boolean;
  workspaceStatusFilter?: SessionStatus[];
}

interface NudgeInput {
  sessionId: string;
  workspaceId: string;
  workingDirectory: string;
  agentType: string;
  title?: string;
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

  constructor(cfg: RelayConfig) {
    this.cfg = cfg;
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
      workspaceSubscribed: false,
    };
    this.connections.set(id, conn);

    ws.on("message", async (data: Buffer | string) => {
      const raw = typeof data === "string" ? data : data.toString();
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
    const daemon = this.daemonByWorkspace.get(input.workspaceId);
    if (!daemon) return;

    this.send(daemon, {
      type: "session_available",
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      agentType: input.agentType,
      title: input.title,
    });
  }

  getStats() {
    return {
      connections: this.connections.size,
      browserCount: Array.from(this.connections.values()).filter((c) => c.kind === "browser").length,
      daemonCount: this.daemonByWorkspace.size,
      sessionSubscriptions: this.subscribers.size,
    };
  }

  // ── Message dispatch ───────────────────────────────────────────────

  private async handleMessage(conn: Connection, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "hello":
        await this.handleHello(conn, msg);
        return;
      case "ping":
        this.send(conn, { type: "pong", ts: new Date().toISOString() });
        return;
    }

    if (conn.kind === "unauth") {
      this.send(conn, createError("NOT_AUTHENTICATED", "Must send hello first"));
      return;
    }

    switch (msg.type) {
      case "subscribe":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Subscribe is for browsers"));
          return;
        }
        await this.handleSubscribe(conn, msg);
        return;
      case "unsubscribe":
        this.handleUnsubscribe(conn, msg);
        return;
      case "input":
        if (conn.kind !== "browser") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "Input is for browsers"));
          return;
        }
        await this.handleInput(conn, msg);
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
        await this.handleSessionClaimed(conn, msg);
        return;
      case "session_event":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_event is for daemons"));
          return;
        }
        await this.handleSessionEvent(conn, msg);
        return;
      case "session_status":
        if (conn.kind !== "daemon") {
          this.send(conn, createError("INVALID_FOR_DEVICE", "session_status is for daemons"));
          return;
        }
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

      // If another daemon was registered for this workspace, boot it.
      const existing = this.daemonByWorkspace.get(hello.workspaceId);
      if (existing && existing !== conn) {
        this.send(existing, createError("SUPERSEDED", "Another daemon connected for this workspace", undefined, false));
        existing.ws.close();
      }
      this.daemonByWorkspace.set(hello.workspaceId, conn);
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
      this.send(conn, { type: "pong", ts: new Date().toISOString() });
    }, this.cfg.heartbeatIntervalMs);

    this.send(conn, {
      type: "hello_ok",
      gatewayTime: new Date().toISOString(),
      heartbeatIntervalMs: this.cfg.heartbeatIntervalMs,
      userId: conn.userId!,
    });
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
  }

  // ── Daemon session_event → persist + fan out ───────────────────────

  private async handleSessionEvent(conn: Connection, event: ClientSessionEvent): Promise<void> {
    // Atomic increment with RETURNING — fuses the auth check into the WHERE clause
    // and avoids the read-then-write race that caused duplicate seq values under burst.
    const updated = await db
      .update(chatConversations)
      .set({ nextSeq: sql`${chatConversations.nextSeq} + 1` })
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
  }

  // ── Daemon session_status → update DB + notify subscribers ─────────

  private async handleSessionStatus(conn: Connection, msg: ClientSessionStatus): Promise<void> {
    const session = await db.query.chatConversations.findFirst({
      where: eq(chatConversations.id, msg.sessionId),
    });
    if (!session || session.userId !== conn.userId) return;

    await db
      .update(chatConversations)
      .set({ status: msg.status })
      .where(eq(chatConversations.id, msg.sessionId));

    const subs = this.subscribers.get(msg.sessionId);
    if (subs) {
      for (const sub of subs) {
        this.send(sub, {
          type: "session_status_changed",
          sessionId: msg.sessionId,
          status: msg.status,
        });
      }
    }

    // Notify workspace subscribers for this user
    if (conn.userId) {
      const userConns = this.clientsByUser.get(conn.userId);
      if (userConns) {
        for (const c of userConns) {
          if (!c.workspaceSubscribed) continue;
          if (c.workspaceStatusFilter?.length && !c.workspaceStatusFilter.includes(msg.status)) continue;
          this.send(c, {
            type: "session_status_changed",
            sessionId: msg.sessionId,
            status: msg.status,
          });
        }
      }
    }
  }

  // ── Workspace subscription ────────────────────────────────────────

  private async handleSubscribeWorkspace(conn: Connection, msg: ClientSubscribeWorkspace): Promise<void> {
    conn.workspaceSubscribed = true;
    conn.workspaceStatusFilter = msg.statusFilter;

    const rows = await db.query.chatConversations.findMany({
      where: eq(chatConversations.userId, conn.userId!),
      orderBy: [desc(chatConversations.lastActivityAt)],
      limit: 200,
    });

    let sessions = rows.map((row) => ({
      sessionId: row.id,
      status: row.status as SessionStatus,
      agentType: row.agentType,
      title: row.title ?? undefined,
      lastActivityAt: row.lastActivityAt ?? new Date().toISOString(),
    }));

    if (msg.statusFilter?.length) {
      sessions = sessions.filter((s) => msg.statusFilter!.includes(s.status));
    }

    this.send(conn, { type: "workspace_snapshot", sessions });
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
