import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ClientMessage, ServerMessage } from "./protocol.js";

// Mock db
vi.mock("@bob/db/client", () => {
  // Default update chain: supports .set().where() → Promise and
  // .set().where().returning() → Promise<rows>. Tests override per-case.
  const makeUpdateChain = () => ({
    set: vi.fn(() => {
      const whereResult: any = Promise.resolve();
      whereResult.returning = vi.fn(() =>
        Promise.resolve([{ newNextSeq: 2 }]),
      );
      return {
        where: vi.fn(() => whereResult),
      };
    }),
  });
  // Default select chain: .from().leftJoin().where().limit() → Promise<rows>,
  // .from().where().limit() → Promise<rows> (the envelope dup check), and
  // .from().where().for("update") → Promise<rows> (the single-writer lock —
  // defaults to a "running" session so status transitions apply).
  const makeSelectChain = () => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([])),
        for: vi.fn(() => Promise.resolve([{ status: "running" }])),
      })),
    })),
  });
  // insert().values() is awaited directly in some paths and chained with
  // .onConflictDoUpdate()/.onConflictDoNothing() in others — return a
  // thenable that supports both.
  const makeInsertValuesResult = () => {
    const p: any = Promise.resolve();
    p.onConflictDoUpdate = vi.fn(() => Promise.resolve());
    p.onConflictDoNothing = vi.fn(() => {
      const q: any = Promise.resolve();
      q.returning = vi.fn(() => Promise.resolve([]));
      return q;
    });
    return p;
  };
  const dbObj: any = {
    query: {
      chatConversations: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])) },
      gatewayConfig: { findFirst: vi.fn(() => Promise.resolve(null)) },
      planDrafts: { findMany: vi.fn(() => Promise.resolve([])) },
      repositories: { findMany: vi.fn(() => Promise.resolve([])) },
      runnerLeases: { findMany: vi.fn(() => Promise.resolve([])) },
      sessionEvents: { findMany: vi.fn() },
      taskRuns: { findFirst: vi.fn(() => Promise.resolve(null)) },
      workItems: { findMany: vi.fn(() => Promise.resolve([])) },
    },
    update: vi.fn(() => makeUpdateChain()),
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => ({ values: vi.fn(() => makeInsertValuesResult()) })),
  };
  // Transactions run the callback against the same mock — tests configure
  // db.select/update/insert as usual and the tx path picks them up.
  dbObj.transaction = vi.fn(async (cb: (tx: any) => Promise<unknown>) => cb(dbObj));
  return { db: dbObj };
});

import { db } from "@bob/db/client";
import { Relay } from "./relay.js";

// Fake WebSocket that captures sent messages
class FakeWs extends EventEmitter {
  readyState = 1; // OPEN
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  receive(msg: ClientMessage) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
  lastSentMessage(): ServerMessage | null {
    const last = this.sent[this.sent.length - 1];
    return last ? JSON.parse(last) : null;
  }
  sentOfType(type: string): ServerMessage[] {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => m.type === type);
  }
}

describe("Relay", () => {
  let relay: Relay;
  let persistedEvents: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    persistedEvents = [];
    relay = new Relay({
      heartbeatIntervalMs: 30000,
      persistEvent: async (event) => {
        persistedEvents.push(event);
      },
      validateBrowserToken: async (token) => (token === "good-browser" ? "user-1" : null),
      validateDaemonAuth: async (token, wsId) =>
        token === "good-daemon" && wsId === "ws-1" ? "user-1" : null,
    });
  });

  describe("browser hello", () => {
    it("authenticates and responds with hello_ok", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      const helloOk = ws.lastSentMessage();
      expect(helloOk?.type).toBe("hello_ok");
      expect((helloOk as any).userId).toBe("user-1");
    });

    it("rejects invalid token and closes connection", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "bad",
      });
      await new Promise((r) => setImmediate(r));

      const err = ws.lastSentMessage();
      expect(err?.type).toBe("error");
      expect((err as any).code).toBe("AUTH_FAILED");
      expect(ws.readyState).toBe(3); // closed
    });
  });

  describe("browser workspace subscription", () => {
    it("includes planning draft and produced task counts in workspace snapshots", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([
        {
          id: "11111111-1111-4111-8111-111111111111",
          userId: "user-1",
          status: "stopped",
          agentType: "planner",
          sessionType: "planning",
          title: "Plan dashboard",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          workItemId: null,
          workItemIdentifierSnapshot: null,
        },
      ]);
      (db.query.planDrafts.findMany as any).mockResolvedValueOnce([
        {
          id: "draft-1",
          sessionId: "11111111-1111-4111-8111-111111111111",
          status: "draft",
        },
        {
          id: "draft-2",
          sessionId: "11111111-1111-4111-8111-111111111111",
          status: "committed",
        },
      ]);

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe_workspace" });
      await new Promise((r) => setImmediate(r));

      const [snapshot] = ws.sentOfType("workspace_snapshot");
      expect((snapshot as any).sessions[0]).toMatchObject({
        sessionId: "11111111-1111-4111-8111-111111111111",
        draftCount: 1,
        producedTaskCount: 1,
      });
    });

    it("scopes workspace snapshots to the requested workspace", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([
        {
          id: "11111111-1111-4111-8111-111111111111",
          userId: "user-1",
          status: "running",
          agentType: "codex",
          sessionType: "execution",
          title: "In workspace",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          repositoryId: "repo-1",
          workItemId: null,
          workItemIdentifierSnapshot: "BOB-1",
          planningWorkspaceId: null,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          userId: "user-1",
          status: "running",
          agentType: "codex",
          sessionType: "execution",
          title: "Other workspace",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          repositoryId: "repo-2",
          workItemId: null,
          workItemIdentifierSnapshot: "OTHER-1",
          planningWorkspaceId: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          userId: "user-1",
          status: "stopped",
          agentType: "planner",
          sessionType: "planning",
          title: "Planning in workspace",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          repositoryId: null,
          workItemId: null,
          workItemIdentifierSnapshot: null,
          planningWorkspaceId: "workspace-1",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          userId: "user-1",
          status: "stopped",
          agentType: "planner",
          sessionType: "planning",
          title: "Planning elsewhere",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
          repositoryId: null,
          workItemId: null,
          workItemIdentifierSnapshot: null,
          planningWorkspaceId: "workspace-2",
        },
      ]);
      (db.query.repositories.findMany as any).mockResolvedValueOnce([
        { id: "repo-1", workspaceId: "workspace-1" },
        { id: "repo-2", workspaceId: "workspace-2" },
      ]);

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe_workspace", workspaceId: "workspace-1" });
      await new Promise((r) => setImmediate(r));

      const [snapshot] = ws.sentOfType("workspace_snapshot");
      expect((snapshot as any).sessions.map((session: any) => session.sessionId)).toEqual([
        "11111111-1111-4111-8111-111111111111",
        "33333333-3333-4333-8333-333333333333",
      ]);
    });

    it("does not broadcast out-of-scope session status changes to workspace subscribers", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([]);
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "22222222-2222-4222-8222-222222222222",
        userId: "user-1",
        status: "running",
        agentType: "codex",
        sessionType: "execution",
        title: "Other workspace",
        repositoryId: "repo-2",
        workItemId: null,
        workItemIdentifierSnapshot: "OTHER-1",
        planningWorkspaceId: null,
      });
      (db.query.repositories.findMany as any).mockResolvedValueOnce([
        { id: "repo-2", workspaceId: "workspace-2" },
      ]);

      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      browserWs.receive({ type: "subscribe_workspace", workspaceId: "workspace-1" });
      await new Promise((r) => setImmediate(r));

      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));
      daemonWs.receive({
        type: "session_status",
        sessionId: "22222222-2222-4222-8222-222222222222",
        status: "idle",
      });
      await new Promise((r) => setImmediate(r));

      expect(browserWs.sentOfType("session_status_changed")).toHaveLength(0);
    });

    it("broadcasts planning draft and produced task counts on session status changes", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([]);
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        userId: "user-1",
        status: "running",
        agentType: "planner",
        sessionType: "planning",
        title: "Planning in workspace",
        repositoryId: null,
        workItemId: null,
        workItemIdentifierSnapshot: null,
        planningWorkspaceId: "workspace-1",
      });
      (db.query.planDrafts.findMany as any).mockResolvedValueOnce([
        {
          id: "draft-1",
          sessionId: "33333333-3333-4333-8333-333333333333",
          status: "draft",
        },
        {
          id: "draft-2",
          sessionId: "33333333-3333-4333-8333-333333333333",
          status: "committed",
        },
      ]);

      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      browserWs.receive({ type: "subscribe_workspace", workspaceId: "workspace-1" });
      await new Promise((r) => setImmediate(r));

      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));
      daemonWs.receive({
        type: "session_status",
        sessionId: "33333333-3333-4333-8333-333333333333",
        status: "idle",
      });
      await new Promise((r) => setImmediate(r));

      const [statusChanged] = browserWs.sentOfType("session_status_changed");
      expect(statusChanged).toMatchObject({
        sessionId: "33333333-3333-4333-8333-333333333333",
        draftCount: 1,
        producedTaskCount: 1,
      });
    });
  });

  describe("daemon hello", () => {
    it("requires workspaceId", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        // workspaceId missing
      });
      await new Promise((r) => setImmediate(r));

      const err = ws.lastSentMessage();
      expect(err?.type).toBe("error");
      expect((err as any).code).toBe("AUTH_FAILED");
    });

    it("authenticates with valid api key and workspaceId", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      const helloOk = ws.lastSentMessage();
      expect(helloOk?.type).toBe("hello_ok");
    });
  });

  describe("browser subscribe", () => {
    it("verifies session ownership before subscribing", async () => {
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-2", // different user
        nextSeq: 5,
        status: "running",
      });

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe", sessionId: "11111111-1111-4111-8111-111111111111", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e) => (e as any).code === "ACCESS_DENIED")).toBe(true);
    });

    it("replays missed events on subscribe", async () => {
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        nextSeq: 5,
        status: "running",
      });
      (db.query.sessionEvents.findMany as any).mockResolvedValueOnce([
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          seq: 3,
          eventType: "output_chunk",
          direction: "agent",
          payload: { data: "hi" },
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
        },
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          seq: 4,
          eventType: "output_chunk",
          direction: "agent",
          payload: { data: "there" },
          createdAt: new Date("2026-04-10T00:00:01.000Z"),
        },
      ]);

      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe", sessionId: "11111111-1111-4111-8111-111111111111", lastAckSeq: 2 });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const events = ws.sentOfType("event");
      expect(events.length).toBe(2);
      expect((events[0] as any).seq).toBe(3);
      expect((events[1] as any).seq).toBe(4);
    });
  });

  describe("session event relay", () => {
    it("persists and forwards daemon events to subscribers", async () => {
      // Set up a daemon
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      // Session exists owned by user-1 in workspace ws-1
      (db.query.chatConversations.findFirst as any)
        .mockResolvedValueOnce({
          id: "11111111-1111-4111-8111-111111111111",
          userId: "user-1",
          nextSeq: 1,
          status: "running",
        })
        .mockResolvedValueOnce({
          id: "11111111-1111-4111-8111-111111111111",
          userId: "user-1",
          nextSeq: 1,
          status: "running",
          // workspace lookup for daemon routing
        });
      (db.query.sessionEvents.findMany as any).mockResolvedValueOnce([]);

      // Set up a subscriber
      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      browserWs.receive({ type: "subscribe", sessionId: "11111111-1111-4111-8111-111111111111", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      // Daemon sends an event
      daemonWs.receive({
        type: "session_event",
        sessionId: "11111111-1111-4111-8111-111111111111",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello" },
      });
      await new Promise((r) => setImmediate(r));

      // Event was persisted
      expect(persistedEvents.length).toBe(1);
      expect(persistedEvents[0].sessionId).toBe("11111111-1111-4111-8111-111111111111");

      // Event was forwarded to the browser subscriber
      const forwarded = browserWs.sentOfType("event");
      expect(forwarded.length).toBeGreaterThan(0);
      expect((forwarded[forwarded.length - 1] as any).payload.data).toBe("hello");
    });

    it("notifies workspace subscribers when a session event is appended", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([]);

      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      browserWs.receive({ type: "subscribe_workspace", workspaceId: "workspace-1" });
      await new Promise((r) => setImmediate(r));

      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        status: "running",
        agentType: "codex",
        sessionType: "execution",
        title: "Realtime dashboard",
        repositoryId: null,
        workItemId: "work-item-1",
        workItemIdentifierSnapshot: "BOB-1",
        planningWorkspaceId: null,
      });
      (db.query.workItems.findMany as any).mockResolvedValueOnce([
        { id: "work-item-1", workspaceId: "workspace-1" },
      ]).mockResolvedValueOnce([
        { id: "work-item-1", workspaceId: "workspace-1" },
      ]);

      daemonWs.receive({
        type: "session_event",
        sessionId: "11111111-1111-4111-8111-111111111111",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "progress" },
      });
      await new Promise((r) => setImmediate(r));

      const updates = browserWs.sentOfType("session_status_changed");
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "running",
        title: "Realtime dashboard",
        workItemId: "work-item-1",
        workItemIdentifier: "BOB-1",
      });
      expect(browserWs.sentOfType("session_event_appended")).toEqual([
        expect.objectContaining({
          type: "session_event_appended",
          workspaceId: "workspace-1",
          entityId: "11111111-1111-4111-8111-111111111111",
        }),
      ]);
    });
  });

  describe("session nudge", () => {
    it("notifies workspace subscribers when work is dispatched", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([]);

      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      browserWs.receive({ type: "subscribe_workspace", workspaceId: "ws-1" });
      await new Promise((r) => setImmediate(r));

      relay.nudgeSession({
        sessionId: "sess-99",
        workspaceId: "ws-1",
        workingDirectory: "/tmp/work",
        agentType: "claude",
        title: "P1-8: Run task",
      });

      expect(browserWs.sentOfType("work_item_dispatched")).toEqual([
        expect.objectContaining({
          type: "work_item_dispatched",
          workspaceId: "ws-1",
          entityId: "sess-99",
        }),
      ]);
    });

    it("pushes session_available to the right daemon", async () => {
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      relay.nudgeSession({
        sessionId: "sess-99",
        workspaceId: "ws-1",
        workingDirectory: "/tmp/work",
        agentType: "claude",
        title: "new idea",
      });

      const nudges = daemonWs.sentOfType("session_available");
      expect(nudges.length).toBe(1);
      expect((nudges[0] as any).sessionId).toBe("sess-99");
    });

    it("silently drops nudge when daemon is offline", () => {
      // No daemon connected
      expect(() =>
        relay.nudgeSession({
          sessionId: "sess-99",
          workspaceId: "ws-1",
          workingDirectory: "/tmp",
          agentType: "claude",
        }),
      ).not.toThrow();
    });
  });

  describe("workspace events", () => {
    it("broadcasts queue order changes to matching workspace subscribers", async () => {
      (db.query.chatConversations.findMany as any).mockResolvedValueOnce([]);

      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      browserWs.receive({ type: "subscribe_workspace", workspaceId: "ws-1" });
      await new Promise((r) => setImmediate(r));

      relay.notifyWorkspaceEvent({
        type: "queue_order_changed",
        workspaceId: "ws-1",
        entityId: "task-1",
      });

      expect(browserWs.sentOfType("queue_order_changed")).toEqual([
        expect.objectContaining({
          type: "queue_order_changed",
          workspaceId: "ws-1",
          entityId: "task-1",
        }),
      ]);
    });
  });

  describe("daemon superseding", () => {
    it("closes the old daemon when a new one connects for the same workspace", async () => {
      const daemon1 = new FakeWs();
      relay.handleConnection(daemon1 as any);
      daemon1.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      const daemon2 = new FakeWs();
      relay.handleConnection(daemon2 as any);
      daemon2.receive({
        type: "hello",
        clientId: "d2",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      // Old daemon should have received a SUPERSEDED error and been closed
      const errors = daemon1.sentOfType("error");
      expect(errors.some((e: any) => e.code === "SUPERSEDED")).toBe(true);
      expect(daemon1.readyState).toBe(3); // closed
    });
  });

  describe("unauth gate", () => {
    it("rejects subscribe before hello with NOT_AUTHENTICATED", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({ type: "subscribe", sessionId: "s", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e: any) => e.code === "NOT_AUTHENTICATED")).toBe(true);
    });

    it("rejects input before hello with NOT_AUTHENTICATED", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);

      ws.receive({ type: "input", sessionId: "s", clientInputId: "i", data: "x" });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e: any) => e.code === "NOT_AUTHENTICATED")).toBe(true);
    });
  });

  describe("cross-kind device restriction", () => {
    it("rejects browser sending session_event", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({ type: "hello", clientId: "c1", deviceType: "web", token: "good-browser" });
      await new Promise((r) => setImmediate(r));

      ws.receive({
        type: "session_event",
        sessionId: "s",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "x" },
      });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e: any) => e.code === "INVALID_FOR_DEVICE")).toBe(true);
    });

    it("rejects daemon sending subscribe", async () => {
      const ws = new FakeWs();
      relay.handleConnection(ws as any);
      ws.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      ws.receive({ type: "subscribe", sessionId: "s", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e: any) => e.code === "INVALID_FOR_DEVICE")).toBe(true);
    });
  });

  describe("stop session", () => {
    const SESSION_ID = "22222222-2222-4222-8222-222222222222";

    // Session lookup used by requestSessionStop: select().from().leftJoin().where().limit()
    const mockSessionLookup = (rows: any[]) => {
      (db.select as any).mockReturnValueOnce({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(rows)),
            })),
          })),
        })),
      });
    };

    const connectDaemon = async () => {
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));
      return daemonWs;
    };

    const connectBrowser = async () => {
      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));
      return browserWs;
    };

    it("relays stop_session to the session's daemon and acks the browser", async () => {
      const daemonWs = await connectDaemon();
      const browserWs = await connectBrowser();

      mockSessionLookup([{ sessionUserId: "user-1", workspaceId: "ws-1" }]);

      browserWs.receive({ type: "stop_session", sessionId: SESSION_ID });
      await new Promise((r) => setImmediate(r));

      const daemonStops = daemonWs.sentOfType("session_stop");
      expect(daemonStops).toHaveLength(1);
      expect((daemonStops[0] as any).sessionId).toBe(SESSION_ID);

      const acks = browserWs.sentOfType("session_stopped");
      expect(acks).toHaveLength(1);
      expect((acks[0] as any).sessionId).toBe(SESSION_ID);
    });

    it("finalizes the session as stopped when no daemon is online", async () => {
      const browserWs = await connectBrowser();

      mockSessionLookup([{ sessionUserId: "user-1", workspaceId: "ws-1" }]);

      browserWs.receive({ type: "stop_session", sessionId: SESSION_ID });
      await new Promise((r) => setImmediate(r));

      // Still acked — nothing is running, session was marked stopped in DB
      expect(browserWs.sentOfType("session_stopped")).toHaveLength(1);
      expect(db.update).toHaveBeenCalled();
    });

    it("rejects stop_session for a session the user doesn't own", async () => {
      const browserWs = await connectBrowser();

      mockSessionLookup([{ sessionUserId: "someone-else", workspaceId: "ws-1" }]);

      browserWs.receive({ type: "stop_session", sessionId: SESSION_ID });
      await new Promise((r) => setImmediate(r));

      const errors = browserWs.sentOfType("error");
      expect(errors.some((e: any) => e.code === "SESSION_NOT_FOUND")).toBe(true);
      expect(browserWs.sentOfType("session_stopped")).toHaveLength(0);
    });

    it("rejects stop_session from daemons", async () => {
      const daemonWs = await connectDaemon();

      daemonWs.receive({ type: "stop_session", sessionId: SESSION_ID });
      await new Promise((r) => setImmediate(r));

      const errors = daemonWs.sentOfType("error");
      expect(errors.some((e: any) => e.code === "INVALID_FOR_DEVICE")).toBe(true);
    });
  });

  describe("session error status", () => {
    it("persists lastError and syncs task_run as failed on an error status", async () => {
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      const SID = "33333333-3333-4333-8333-333333333333";
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: SID,
        userId: "user-1",
        status: "running",
        workItemId: "wi-1",
        agentType: "claude",
      });
      (db.query.taskRuns.findFirst as any) = vi.fn(() =>
        Promise.resolve({ id: "tr-1", workItemId: "wi-1" }),
      );

      // Capture every .set() payload across the status handler's DB writes.
      const setPayloads: any[] = [];
      (db.update as any).mockImplementation(() => ({
        set: (payload: any) => {
          setPayloads.push(payload);
          return { where: () => Promise.resolve() };
        },
      }));

      daemonWs.receive({
        type: "session_status",
        sessionId: SID,
        status: "error",
        summary: { code: "AGENT_ERROR", error: "boom: agent exited 1" },
      } as any);
      await new Promise((r) => setImmediate(r));

      // chatConversations got status "error" + a structured lastError
      const convUpdate = setPayloads.find((p) => p.lastError);
      expect(convUpdate?.status).toBe("error");
      expect(convUpdate?.lastError?.message).toBe("boom: agent exited 1");
      expect(convUpdate?.lastError?.code).toBe("AGENT_ERROR");

      // task_run got the enum-safe "failed" (not "error") + the reason
      const taskUpdate = setPayloads.find(
        (p) => p.status === "failed" && "blockedReason" in p,
      );
      expect(taskUpdate?.blockedReason).toBe("boom: agent exited 1");
    });
  });

  describe("envelope protocol (send-seq)", () => {
    const SID = "44444444-4444-4444-8444-444444444444";

    // vi.clearAllMocks() clears calls but NOT implementations installed by
    // earlier tests via mockImplementation — restore the default chains this
    // suite depends on so test order can't poison the tx path.
    beforeEach(() => {
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          leftJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
          where: () => ({
            limit: () => Promise.resolve([]),
            for: () => Promise.resolve([{ status: "running" }]),
          }),
        }),
      }));
      (db.update as any).mockImplementation(() => ({
        set: () => {
          const whereResult: any = Promise.resolve();
          whereResult.returning = vi.fn(() => Promise.resolve([{ newNextSeq: 2 }]));
          return { where: () => whereResult };
        },
      }));
      (db.insert as any).mockImplementation(() => ({
        values: () => Promise.resolve(),
      }));
    });

    async function connectDaemon(): Promise<FakeWs> {
      const daemonWs = new FakeWs();
      relay.handleConnection(daemonWs as any);
      daemonWs.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));
      return daemonWs;
    }

    it("persists an enveloped event transactionally, then acks", async () => {
      const daemonWs = await connectDaemon();
      const inserted: any[] = [];
      (db.insert as any).mockImplementation(() => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve();
        },
      }));
      (db.query.chatConversations.findFirst as any).mockResolvedValue({
        id: SID,
        userId: "user-1",
        status: "running",
      });

      daemonWs.receive({
        type: "session_event",
        sessionId: SID,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello" },
        sendSeq: 7,
      } as any);
      await new Promise((r) => setImmediate(r));

      // Persisted synchronously in the tx (NOT via the batched writer)…
      expect(inserted).toHaveLength(1);
      expect(inserted[0].sendSeq).toBe(7);
      expect(persistedEvents).toHaveLength(0);
      // …and acked after commit.
      const acks = daemonWs.sentOfType("event_ack");
      expect(acks).toHaveLength(1);
      expect((acks[0] as any).sendSeq).toBe(7);
      // The transaction wrapper was actually used.
      expect((db as any).transaction).toHaveBeenCalled();
    });

    it("acks a redelivered send-seq without inserting a second row", async () => {
      const daemonWs = await connectDaemon();
      // Dup check finds an existing row for (sessionId, sendSeq).
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: "existing" }]) }),
          leftJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        }),
      }));
      const inserted: any[] = [];
      (db.insert as any).mockImplementation(() => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve();
        },
      }));

      daemonWs.receive({
        type: "session_event",
        sessionId: SID,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "again" },
        sendSeq: 7,
      } as any);
      await new Promise((r) => setImmediate(r));

      expect(inserted).toHaveLength(0);
      const acks = daemonWs.sentOfType("event_ack");
      expect(acks).toHaveLength(1);
      expect((acks[0] as any).sendSeq).toBe(7);
    });

    it("persists session_status as a durable status_change event and applies side effects once", async () => {
      const daemonWs = await connectDaemon();
      const inserted: any[] = [];
      (db.insert as any).mockImplementation(() => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve();
        },
      }));
      (db.query.chatConversations.findFirst as any).mockResolvedValue({
        id: SID,
        userId: "user-1",
        status: "running",
        workItemId: null,
        agentType: "claude",
      });
      const setPayloads: any[] = [];
      (db.update as any).mockImplementation(() => ({
        set: (payload: any) => {
          setPayloads.push(payload);
          const whereResult: any = Promise.resolve();
          whereResult.returning = vi.fn(() => Promise.resolve([{ newNextSeq: 2 }]));
          return { where: () => whereResult };
        },
      }));

      daemonWs.receive({
        type: "session_status",
        sessionId: SID,
        status: "completed",
        sendSeq: 3,
      } as any);
      await new Promise((r) => setImmediate(r));

      // The transition itself became a durable event row.
      const statusRow = inserted.find((v) => v.eventType === "status_change");
      expect(statusRow).toBeDefined();
      expect(statusRow.sendSeq).toBe(3);
      expect(statusRow.payload.status).toBe("completed");
      // Acked.
      expect(daemonWs.sentOfType("event_ack")).toHaveLength(1);
      // Side effects ran (status column written).
      expect(setPayloads.some((p) => p.status === "completed")).toBe(true);
    });

    it("does not re-apply side effects for a redelivered session_status", async () => {
      const daemonWs = await connectDaemon();
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ id: "existing" }]) }),
          leftJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
        }),
      }));
      (db.query.chatConversations.findFirst as any).mockClear();

      daemonWs.receive({
        type: "session_status",
        sessionId: SID,
        status: "completed",
        sendSeq: 3,
      } as any);
      await new Promise((r) => setImmediate(r));

      // Ack only — applySessionStatus never ran (no session lookup).
      expect(daemonWs.sentOfType("event_ack")).toHaveLength(1);
      expect(db.query.chatConversations.findFirst).not.toHaveBeenCalled();
    });

    it("relays a browser approve to the daemon as an approval event and acks it", async () => {
      const daemonWs = await connectDaemon();
      const browserWs = new FakeWs();
      relay.handleConnection(browserWs as any);
      browserWs.receive({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "good-browser",
      });
      await new Promise((r) => setImmediate(r));

      // Session ownership lookup: owned by user-1, workspace ws-1.
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([{ sessionUserId: "user-1", workspaceId: "ws-1" }]),
            }),
          }),
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }));

      browserWs.receive({
        type: "approve",
        sessionId: SID,
        requestId: "req-9",
        decision: "allow",
        clientInputId: "ci-1",
      } as any);
      await new Promise((r) => setImmediate(r));

      const forwarded = daemonWs
        .sentOfType("event")
        .find((m: any) => m.eventType === "approval") as any;
      expect(forwarded).toBeDefined();
      expect(forwarded.payload.requestId).toBe("req-9");
      expect(forwarded.payload.decision).toBe("allow");

      const acks = browserWs.sentOfType("input_ack") as any[];
      expect(acks.some((a) => a.clientInputId === "ci-1")).toBe(true);
    });

    it("legacy events without sendSeq keep the batched-writer path", async () => {
      const daemonWs = await connectDaemon();
      (db.query.chatConversations.findFirst as any).mockResolvedValue({
        id: SID,
        userId: "user-1",
        status: "running",
      });

      daemonWs.receive({
        type: "session_event",
        sessionId: SID,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "legacy" },
      });
      await new Promise((r) => setImmediate(r));

      expect(persistedEvents).toHaveLength(1);
      expect(daemonWs.sentOfType("event_ack")).toHaveLength(0);
    });
  });

  describe("lease sweep + single-writer state (trust model)", () => {
    const SID = "66666666-6666-4666-8666-666666666666";

    beforeEach(() => {
      // Defaults: no leases expired, single-writer lock sees a running session.
      (db.query.runnerLeases.findMany as any).mockResolvedValue([]);
      (db.query.gatewayConfig.findFirst as any).mockResolvedValue(null);
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          leftJoin: () => ({ where: () => Promise.resolve([]) }),
          where: () => ({
            limit: () => Promise.resolve([]),
            for: () => Promise.resolve([{ status: "running" }]),
          }),
        }),
      }));
      (db.update as any).mockImplementation(() => ({
        set: () => {
          const whereResult: any = Promise.resolve();
          whereResult.returning = vi.fn(() => Promise.resolve([{ newNextSeq: 2 }]));
          whereResult.catch = Promise.prototype.catch.bind(whereResult);
          return { where: () => whereResult };
        },
      }));
    });

    it("CRITICAL regression: a silent run on a healthy host is NEVER timed out to failed", async () => {
      // The old 35-minute inactivity sweep is gone. With no expired lease,
      // the sweep must not touch any session — no matter how long a run has
      // been quiet (a 40-minute compile inside a tool call is healthy).
      const setPayloads: any[] = [];
      (db.update as any).mockImplementation(() => ({
        set: (p: any) => {
          setPayloads.push(p);
          return { where: () => Promise.resolve() };
        },
      }));

      await (relay as any).sweepExpiredLeases();

      expect(setPayloads.some((p) => p.status === "failed")).toBe(false);
      expect(setPayloads.some((p) => p.status)).toBe(false);
    });

    it("CRITICAL regression: an expired lease produces host_unknown, never failed", async () => {
      (db.query.runnerLeases.findMany as any).mockResolvedValue([
        { workspaceId: "ws-2", hostId: "hetzner-bob", lastHeartbeatAt: "old" },
      ]);
      // Session lookup for the workspace returns one active session; the
      // FOR UPDATE lock sees it running.
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          leftJoin: () => ({
            where: () =>
              Promise.resolve([
                { id: SID, userId: "user-1", workItemId: null, agentType: "claude" },
              ]),
          }),
          where: () => ({
            limit: () => Promise.resolve([]),
            for: () => Promise.resolve([{ status: "running" }]),
          }),
        }),
      }));
      const setPayloads: any[] = [];
      (db.update as any).mockImplementation(() => ({
        set: (p: any) => {
          setPayloads.push(p);
          return { where: () => Promise.resolve() };
        },
      }));

      await (relay as any).sweepExpiredLeases();

      expect(setPayloads.some((p) => p.status === "host_unknown")).toBe(true);
      expect(setPayloads.some((p) => p.status === "failed")).toBe(false);
      // host_unknown is not terminal: no completedAt stamp.
      expect(setPayloads.find((p) => p.status === "host_unknown")?.completedAt).toBeUndefined();
    });

    it("precedence: host_unknown never downgrades a terminal state", async () => {
      const result = await withLockedStatus("completed", () =>
        (relay as any).deriveAndWriteState(SID, "host_unknown"),
      );
      expect(result.applied).toBe(false);
      expect(result.previous).toBe("completed");
    });

    it("precedence: a late completed overwrites host_unknown and is flagged corrective", async () => {
      const result = await withLockedStatus("host_unknown", () =>
        (relay as any).deriveAndWriteState(SID, "completed"),
      );
      expect(result.applied).toBe(true);
      expect(result.corrective).toBe(true);
    });

    it("precedence: normal transitions apply without the corrective flag", async () => {
      const result = await withLockedStatus("running", () =>
        (relay as any).deriveAndWriteState(SID, "blocked"),
      );
      expect(result.applied).toBe(true);
      expect(result.corrective).toBe(false);
    });

    it("guard: onlyIfPrevIn rejects transitions from unlisted states", async () => {
      const result = await withLockedStatus("completed", () =>
        (relay as any).deriveAndWriteState(SID, "stopping", undefined, [
          "running",
          "starting",
        ]),
      );
      expect(result.applied).toBe(false);
    });

    async function withLockedStatus(
      status: string,
      fn: () => Promise<{ applied: boolean; previous: string | null; corrective: boolean }>,
    ): Promise<{ applied: boolean; previous: string | null; corrective: boolean }> {
      (db.select as any).mockImplementation(() => ({
        from: () => ({
          leftJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
          where: () => ({
            limit: () => Promise.resolve([]),
            for: () => Promise.resolve([{ status }]),
          }),
        }),
      }));
      return fn();
    }
  });

  describe("cleanup on close", () => {
    it("removes daemon from map when connection closes", async () => {
      const daemon = new FakeWs();
      relay.handleConnection(daemon as any);
      daemon.receive({
        type: "hello",
        clientId: "d1",
        deviceType: "daemon",
        token: "good-daemon",
        workspaceId: "ws-1",
      });
      await new Promise((r) => setImmediate(r));

      expect(relay.getStats().daemonCount).toBe(1);

      daemon.close();
      await new Promise((r) => setImmediate(r));

      expect(relay.getStats().daemonCount).toBe(0);
    });
  });
});
