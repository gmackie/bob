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
  // Default select chain: .from().leftJoin().where().limit() → Promise<rows>
  const makeSelectChain = () => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  });
  return {
    db: {
      query: {
        chatConversations: { findFirst: vi.fn(), findMany: vi.fn(() => Promise.resolve([])) },
        planDrafts: { findMany: vi.fn(() => Promise.resolve([])) },
        repositories: { findMany: vi.fn(() => Promise.resolve([])) },
        sessionEvents: { findMany: vi.fn() },
        workItems: { findMany: vi.fn(() => Promise.resolve([])) },
      },
      update: vi.fn(() => makeUpdateChain()),
      select: vi.fn(() => makeSelectChain()),
    },
  };
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
