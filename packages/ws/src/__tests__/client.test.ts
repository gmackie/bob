import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BobWsClient, type BobWsClientOptions, type ConnectionState, type IWebSocketConstructor } from "../client.js";
import type { ServerMessage } from "../protocol.js";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type WSListener = ((ev: { data: string }) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onmessage: WSListener = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3; // CLOSED
  }

  // test helpers
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  simulateMessage(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  lastSentParsed(): Record<string, unknown> | null {
    const last = this.sent[this.sent.length - 1];
    return last ? (JSON.parse(last) as Record<string, unknown>) : null;
  }

  sentParsed(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOptions(overrides?: Partial<BobWsClientOptions>): BobWsClientOptions {
  return {
    url: "ws://localhost:3002",
    token: "test-token",
    clientId: "test-client",
    deviceType: "web",
    onEvent: vi.fn(),
    onSessionStatus: vi.fn(),
    onError: vi.fn(),
    onConnectionStateChange: vi.fn(),
    WebSocketImpl: MockWebSocket as unknown as IWebSocketConstructor,
    ...overrides,
  };
}

function latestWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
}

function connectAndAuth(client: BobWsClient): MockWebSocket {
  client.connect();
  const ws = latestWs();
  ws.simulateOpen();
  // Respond with hello_ok
  ws.simulateMessage({
    type: "hello_ok",
    gatewayTime: new Date().toISOString(),
    heartbeatIntervalMs: 30_000,
    userId: "user-1",
  });
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BobWsClient", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- connection lifecycle ------------------------------------------------

  describe("connection lifecycle", () => {
    it("sends hello on connect", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      client.connect();
      const ws = latestWs();
      ws.simulateOpen();

      const hello = ws.lastSentParsed();
      expect(hello).toMatchObject({
        type: "hello",
        clientId: "test-client",
        deviceType: "web",
        token: "test-token",
      });
    });

    it("transitions through connecting -> connected", () => {
      const states: ConnectionState[] = [];
      const opts = makeOptions({
        onConnectionStateChange: (s) => states.push(s),
      });
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      expect(states).toEqual(["connecting", "connected"]);
    });

    it("transitions to disconnected on intentional close", () => {
      const states: ConnectionState[] = [];
      const opts = makeOptions({
        onConnectionStateChange: (s) => states.push(s),
      });
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      client.disconnect();
      expect(states[states.length - 1]).toBe("disconnected");
    });

    it("does not reconnect after intentional disconnect", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      const countBefore = MockWebSocket.instances.length;
      client.disconnect();

      vi.advanceTimersByTime(60_000);
      expect(MockWebSocket.instances.length).toBe(countBefore);
    });
  });

  // -- reconnection --------------------------------------------------------

  describe("reconnection", () => {
    it("reconnects with exponential backoff", () => {
      const states: ConnectionState[] = [];
      const opts = makeOptions({
        onConnectionStateChange: (s) => states.push(s),
      });
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      const ws1 = latestWs();
      ws1.simulateClose();

      expect(states[states.length - 1]).toBe("reconnecting");

      // First reconnect after 1s
      vi.advanceTimersByTime(1_000);
      expect(MockWebSocket.instances.length).toBe(2);

      // Close again — next reconnect after 2s
      const ws2 = latestWs();
      ws2.simulateClose();
      vi.advanceTimersByTime(1_999);
      expect(MockWebSocket.instances.length).toBe(2); // not yet
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(3);
    });

    it("caps backoff at 30s", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      // Simulate many disconnects to push backoff past cap
      for (let i = 0; i < 10; i++) {
        const ws = latestWs();
        ws.simulateClose();
        vi.advanceTimersByTime(30_000);
      }

      const currentCount = MockWebSocket.instances.length;
      const ws = latestWs();
      ws.simulateClose();

      // At 30s cap, should reconnect exactly at 30s
      vi.advanceTimersByTime(29_999);
      expect(MockWebSocket.instances.length).toBe(currentCount);
      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances.length).toBe(currentCount + 1);
    });

    it("resets backoff counter after successful connect", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      // Disconnect and reconnect a few times
      latestWs().simulateClose();
      vi.advanceTimersByTime(1_000);
      latestWs().simulateClose();
      vi.advanceTimersByTime(2_000);

      // Now successfully reconnect
      const ws3 = latestWs();
      ws3.simulateOpen();
      ws3.simulateMessage({
        type: "hello_ok",
        gatewayTime: new Date().toISOString(),
        heartbeatIntervalMs: 30_000,
        userId: "user-1",
      });

      // Disconnect again — should be back to 1s
      ws3.simulateClose();
      vi.advanceTimersByTime(1_000);
      expect(MockWebSocket.instances.length).toBe(4);
    });
  });

  // -- subscription tracking -----------------------------------------------

  describe("subscription tracking", () => {
    it("resubscribes to sessions on reconnect", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws1 = connectAndAuth(client);

      client.subscribe("session-1", 0);
      client.subscribe("session-2", 5);

      // Disconnect
      ws1.simulateClose();
      vi.advanceTimersByTime(1_000);

      // New connection
      const ws2 = latestWs();
      ws2.simulateOpen();
      ws2.simulateMessage({
        type: "hello_ok",
        gatewayTime: new Date().toISOString(),
        heartbeatIntervalMs: 30_000,
        userId: "user-1",
      });

      // Should have hello + 2 resubscriptions
      const messages = ws2.sentParsed();
      const subs = messages.filter((m) => m.type === "subscribe");
      expect(subs).toHaveLength(2);
      expect(subs).toContainEqual(
        expect.objectContaining({ type: "subscribe", sessionId: "session-1" }),
      );
      expect(subs).toContainEqual(
        expect.objectContaining({ type: "subscribe", sessionId: "session-2", lastAckSeq: 5 }),
      );
    });

    it("removes session from tracking on unsubscribe", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws1 = connectAndAuth(client);

      client.subscribe("session-1");
      client.unsubscribe("session-1");

      // Disconnect and reconnect
      ws1.simulateClose();
      vi.advanceTimersByTime(1_000);
      const ws2 = latestWs();
      ws2.simulateOpen();
      ws2.simulateMessage({
        type: "hello_ok",
        gatewayTime: new Date().toISOString(),
        heartbeatIntervalMs: 30_000,
        userId: "user-1",
      });

      const subs = ws2.sentParsed().filter((m) => m.type === "subscribe");
      expect(subs).toHaveLength(0);
    });

    it("resubscribes workspace on reconnect", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws1 = connectAndAuth(client);

      client.subscribeWorkspace(["running", "idle"]);

      ws1.simulateClose();
      vi.advanceTimersByTime(1_000);
      const ws2 = latestWs();
      ws2.simulateOpen();
      ws2.simulateMessage({
        type: "hello_ok",
        gatewayTime: new Date().toISOString(),
        heartbeatIntervalMs: 30_000,
        userId: "user-1",
      });

      const wsSubs = ws2.sentParsed().filter((m) => m.type === "subscribe_workspace");
      expect(wsSubs).toHaveLength(1);
      expect(wsSubs[0]).toMatchObject({
        type: "subscribe_workspace",
        statusFilter: ["running", "idle"],
      });
    });

    it("tracks latest seq from events for resubscription", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws1 = connectAndAuth(client);

      client.subscribe("session-1", 0);

      // Receive some events
      ws1.simulateMessage({
        type: "event",
        sessionId: "session-1",
        seq: 10,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello" },
        createdAt: new Date().toISOString(),
      });

      // Disconnect and reconnect
      ws1.simulateClose();
      vi.advanceTimersByTime(1_000);
      const ws2 = latestWs();
      ws2.simulateOpen();
      ws2.simulateMessage({
        type: "hello_ok",
        gatewayTime: new Date().toISOString(),
        heartbeatIntervalMs: 30_000,
        userId: "user-1",
      });

      const subs = ws2.sentParsed().filter((m) => m.type === "subscribe");
      expect(subs[0]).toMatchObject({ sessionId: "session-1", lastAckSeq: 10 });
    });
  });

  // -- message routing -----------------------------------------------------

  describe("message routing", () => {
    it("routes events to onEvent callback", () => {
      const onEvent = vi.fn();
      const opts = makeOptions({ onEvent });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      const event: ServerMessage = {
        type: "event",
        sessionId: "s-1",
        seq: 1,
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "test" },
        createdAt: new Date().toISOString(),
      };
      ws.simulateMessage(event);

      expect(onEvent).toHaveBeenCalledWith("s-1", event);
    });

    it("routes subscribed to onSessionStatus", () => {
      const onSessionStatus = vi.fn();
      const opts = makeOptions({ onSessionStatus });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      ws.simulateMessage({
        type: "subscribed",
        sessionId: "s-1",
        currentState: "running",
        latestSeq: 5,
      });

      expect(onSessionStatus).toHaveBeenCalledWith("s-1", "running");
    });

    it("routes session_created to onSessionStatus", () => {
      const onSessionStatus = vi.fn();
      const opts = makeOptions({ onSessionStatus });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      ws.simulateMessage({
        type: "session_created",
        sessionId: "s-new",
        status: "provisioning",
      });

      expect(onSessionStatus).toHaveBeenCalledWith("s-new", "provisioning");
    });

    it("routes session_stopped to onSessionStatus", () => {
      const onSessionStatus = vi.fn();
      const opts = makeOptions({ onSessionStatus });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      ws.simulateMessage({ type: "session_stopped", sessionId: "s-1" });

      expect(onSessionStatus).toHaveBeenCalledWith("s-1", "stopped");
    });

    it("routes errors to onError", () => {
      const onError = vi.fn();
      const opts = makeOptions({ onError });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      const error: ServerMessage = {
        type: "error",
        code: "AUTH_FAILED",
        message: "bad token",
        retryable: false,
      };
      ws.simulateMessage(error);

      expect(onError).toHaveBeenCalledWith(error);
    });

    it("routes workspace_snapshot to callback", () => {
      const onWorkspaceSnapshot = vi.fn();
      const opts = makeOptions({ onWorkspaceSnapshot });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      const sessions = [
        {
          sessionId: "s-1",
          status: "running" as const,
          agentType: "claude",
          lastActivityAt: new Date().toISOString(),
        },
      ];
      ws.simulateMessage({ type: "workspace_snapshot", sessions });

      expect(onWorkspaceSnapshot).toHaveBeenCalledWith(sessions);
    });

    it("routes session_status_changed to callback", () => {
      const onSessionStatusChanged = vi.fn();
      const opts = makeOptions({ onSessionStatusChanged });
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      const msg: ServerMessage = {
        type: "session_status_changed",
        sessionId: "s-1",
        status: "idle",
        agentType: "claude",
      };
      ws.simulateMessage(msg);

      expect(onSessionStatusChanged).toHaveBeenCalledWith(msg);
    });
  });

  // -- heartbeat -----------------------------------------------------------

  describe("heartbeat", () => {
    it("sends periodic pings", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      // heartbeat = 30s * 0.8 = 24s
      vi.advanceTimersByTime(24_000);
      const pings = ws.sentParsed().filter((m) => m.type === "ping");
      expect(pings).toHaveLength(1);
    });

    it("closes connection when pong not received", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      // Trigger a ping
      vi.advanceTimersByTime(24_000);
      expect(ws.closed).toBe(false);

      // Pong timeout = 10s
      vi.advanceTimersByTime(10_000);
      expect(ws.closed).toBe(true);
    });

    it("does not close connection when pong received in time", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      vi.advanceTimersByTime(24_000);
      ws.simulateMessage({ type: "pong", ts: new Date().toISOString() });

      vi.advanceTimersByTime(10_000);
      expect(ws.closed).toBe(false);
    });
  });

  // -- sendInput -----------------------------------------------------------

  describe("sendInput", () => {
    it("returns unique clientInputId", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      connectAndAuth(client);

      const id1 = client.sendInput("s-1", "hello");
      const id2 = client.sendInput("s-1", "world");

      expect(id1).not.toBe(id2);
      expect(id1).toContain("test-client-");
    });

    it("sends input message with correct format", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      client.sendInput("s-1", "hello");

      const inputs = ws.sentParsed().filter((m) => m.type === "input");
      expect(inputs).toHaveLength(1);
      expect(inputs[0]).toMatchObject({
        type: "input",
        sessionId: "s-1",
        data: "hello",
      });
    });
  });

  // -- createSession / stopSession -----------------------------------------

  describe("session management", () => {
    it("sends create_session", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      client.createSession({
        workingDirectory: "/tmp/test",
        agentType: "claude",
        title: "Test Session",
      });

      const creates = ws.sentParsed().filter((m) => m.type === "create_session");
      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({
        type: "create_session",
        workingDirectory: "/tmp/test",
        agentType: "claude",
        title: "Test Session",
      });
    });

    it("sends stop_session", () => {
      const opts = makeOptions();
      const client = new BobWsClient(opts);
      const ws = connectAndAuth(client);

      client.stopSession("s-1");

      const stops = ws.sentParsed().filter((m) => m.type === "stop_session");
      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({ type: "stop_session", sessionId: "s-1" });
    });
  });
});
