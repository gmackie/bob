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
        chatConversations: { findFirst: vi.fn() },
        sessionEvents: { findMany: vi.fn() },
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
        id: "sess-1",
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

      ws.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      const errors = ws.sentOfType("error");
      expect(errors.some((e) => (e as any).code === "ACCESS_DENIED")).toBe(true);
    });

    it("replays missed events on subscribe", async () => {
      (db.query.chatConversations.findFirst as any).mockResolvedValueOnce({
        id: "sess-1",
        userId: "user-1",
        nextSeq: 5,
        status: "running",
      });
      (db.query.sessionEvents.findMany as any).mockResolvedValueOnce([
        {
          sessionId: "sess-1",
          seq: 3,
          eventType: "output_chunk",
          direction: "agent",
          payload: { data: "hi" },
          createdAt: new Date("2026-04-10T00:00:00.000Z"),
        },
        {
          sessionId: "sess-1",
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

      ws.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 2 });
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
          id: "sess-1",
          userId: "user-1",
          nextSeq: 1,
          status: "running",
        })
        .mockResolvedValueOnce({
          id: "sess-1",
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

      browserWs.receive({ type: "subscribe", sessionId: "sess-1", lastAckSeq: 0 });
      await new Promise((r) => setImmediate(r));

      // Daemon sends an event
      daemonWs.receive({
        type: "session_event",
        sessionId: "sess-1",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello" },
      });
      await new Promise((r) => setImmediate(r));

      // Event was persisted
      expect(persistedEvents.length).toBe(1);
      expect(persistedEvents[0].sessionId).toBe("sess-1");

      // Event was forwarded to the browser subscriber
      const forwarded = browserWs.sentOfType("event");
      expect(forwarded.length).toBeGreaterThan(0);
      expect((forwarded[forwarded.length - 1] as any).payload.data).toBe("hello");
    });
  });

  describe("session nudge", () => {
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
