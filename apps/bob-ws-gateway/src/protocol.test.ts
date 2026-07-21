import { describe, it, expect } from "vitest";
import { parseClientMessage, encodeServerMessage } from "./protocol.js";

describe("protocol", () => {
  describe("parseClientMessage", () => {
    it("parses a browser hello message", () => {
      const raw = JSON.stringify({
        type: "hello",
        clientId: "client-1",
        deviceType: "web",
        token: "session-token-xyz",
      });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({
        type: "hello",
        clientId: "client-1",
        deviceType: "web",
        token: "session-token-xyz",
      });
    });

    it("parses a daemon hello message with workspaceId", () => {
      const raw = JSON.stringify({
        type: "hello",
        clientId: "daemon-1",
        deviceType: "daemon",
        token: "api-key-abc",
        workspaceId: "ws-uuid-123",
      });
      const msg = parseClientMessage(raw);
      expect(msg).toEqual({
        type: "hello",
        clientId: "daemon-1",
        deviceType: "daemon",
        token: "api-key-abc",
        workspaceId: "ws-uuid-123",
      });
    });

    it("parses a versioned daemon host snapshot without credentials", () => {
      const raw = JSON.stringify({
        type: "hello",
        clientId: "hetzner-bob",
        deviceType: "daemon",
        token: "api-key-abc",
        workspaceId: "ws-uuid-123",
        hostSnapshot: {
          schemaVersion: 1,
          hostId: "hetzner-bob",
          daemonVersion: "0.1.0",
          queueDepth: 2,
          checkedAt: "2026-07-11T18:00:00.000Z",
          providers: [{
            provider: "grok",
            command: "grok",
            installed: true,
            authenticated: true,
            status: "ready",
            checkedAt: "2026-07-11T18:00:00.000Z",
            capabilities: { cancel: true },
          }],
        },
      });

      expect(parseClientMessage(raw)).toMatchObject({
        type: "hello",
        hostSnapshot: { schemaVersion: 1, hostId: "hetzner-bob" },
      });
    });

    it("parses a session_event message from a daemon", () => {
      const raw = JSON.stringify({
        type: "session_event",
        sessionId: "sess-1",
        eventType: "output_chunk",
        direction: "agent",
        payload: { data: "hello", stream: "stdout" },
      });
      const msg = parseClientMessage(raw);
      expect(msg?.type).toBe("session_event");
    });

    it("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    it("returns null for missing type field", () => {
      expect(parseClientMessage('{"foo": "bar"}')).toBeNull();
    });
  });

  describe("encodeServerMessage", () => {
    it("encodes a hello_ok message", () => {
      const encoded = encodeServerMessage({
        type: "hello_ok",
        gatewayTime: "2026-04-10T00:00:00.000Z",
        heartbeatIntervalMs: 30000,
        userId: "user-1",
      });
      expect(JSON.parse(encoded)).toEqual({
        type: "hello_ok",
        gatewayTime: "2026-04-10T00:00:00.000Z",
        heartbeatIntervalMs: 30000,
        userId: "user-1",
      });
    });

    it("encodes a session_available message to a daemon", () => {
      const encoded = encodeServerMessage({
        type: "session_available",
        sessionId: "sess-1",
        workingDirectory: "/tmp/work",
        agentType: "claude",
        title: "test session",
      });
      expect(JSON.parse(encoded).type).toBe("session_available");
    });

    it("encodes design-plan workspace invalidation messages", () => {
      const encoded = encodeServerMessage({
        type: "task_priority_changed",
        workspaceId: "workspace-1",
        entityId: "task-1",
        createdAt: "2026-05-31T12:00:00.000Z",
      });

      expect(JSON.parse(encoded)).toEqual({
        type: "task_priority_changed",
        workspaceId: "workspace-1",
        entityId: "task-1",
        createdAt: "2026-05-31T12:00:00.000Z",
      });
    });
  });
});
