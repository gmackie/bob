import { describe, it, expect } from "vitest";
import {
  parseClientMessage,
  encodeServerMessage,
  type ClientSubscribeWorkspace,
  type ClientUnsubscribeWorkspace,
  type ServerWorkspaceSnapshot,
  type ServerSessionStatusChanged,
} from "../protocol.js";

describe("parseClientMessage", () => {
  it("returns null for invalid JSON", () => {
    expect(parseClientMessage("not-json")).toBeNull();
  });

  it("returns null for missing type field", () => {
    expect(parseClientMessage(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null for non-object", () => {
    expect(parseClientMessage(JSON.stringify(42))).toBeNull();
    expect(parseClientMessage(JSON.stringify(null))).toBeNull();
  });

  it("parses hello message", () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: "hello",
        clientId: "c1",
        deviceType: "web",
        token: "tok",
      }),
    );
    expect(msg).toEqual({
      type: "hello",
      clientId: "c1",
      deviceType: "web",
      token: "tok",
    });
  });

  it("parses subscribe message", () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: "subscribe",
        sessionId: "s1",
        lastAckSeq: 5,
      }),
    );
    expect(msg).toEqual({
      type: "subscribe",
      sessionId: "s1",
      lastAckSeq: 5,
    });
  });

  it("parses subscribe_workspace message without filter", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "subscribe_workspace" }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("subscribe_workspace");
    const wsMsg = msg as ClientSubscribeWorkspace;
    expect(wsMsg.statusFilter).toBeUndefined();
  });

  it("parses subscribe_workspace message with statusFilter", () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: "subscribe_workspace",
        statusFilter: ["running", "idle"],
      }),
    );
    expect(msg).not.toBeNull();
    const wsMsg = msg as ClientSubscribeWorkspace;
    expect(wsMsg.type).toBe("subscribe_workspace");
    expect(wsMsg.statusFilter).toEqual(["running", "idle"]);
  });

  it("parses unsubscribe_workspace message", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "unsubscribe_workspace" }),
    );
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("unsubscribe_workspace");
  });

  it("parses create_session message", () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: "create_session",
        workingDirectory: "/tmp",
        agentType: "claude",
      }),
    );
    expect(msg).toEqual({
      type: "create_session",
      workingDirectory: "/tmp",
      agentType: "claude",
    });
  });

  it("parses stop_session message", () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: "stop_session", sessionId: "s1" }),
    );
    expect(msg).toEqual({ type: "stop_session", sessionId: "s1" });
  });
});

describe("encodeServerMessage", () => {
  it("encodes workspace_snapshot", () => {
    const msg: ServerWorkspaceSnapshot = {
      type: "workspace_snapshot",
      sessions: [
        {
          sessionId: "s1",
          status: "running",
          agentType: "claude",
          title: "My session",
          lastActivityAt: "2026-04-03T00:00:00Z",
        },
        {
          sessionId: "s2",
          status: "idle",
          agentType: "opencode",
          lastActivityAt: "2026-04-02T00:00:00Z",
        },
      ],
    };
    const encoded = encodeServerMessage(msg);
    const decoded = JSON.parse(encoded);
    expect(decoded.type).toBe("workspace_snapshot");
    expect(decoded.sessions).toHaveLength(2);
    expect(decoded.sessions[0].sessionId).toBe("s1");
    expect(decoded.sessions[0].title).toBe("My session");
    expect(decoded.sessions[1].title).toBeUndefined();
  });

  it("encodes session_status_changed", () => {
    const msg: ServerSessionStatusChanged = {
      type: "session_status_changed",
      sessionId: "s1",
      status: "stopped",
      agentType: "claude",
      title: "Done",
    };
    const encoded = encodeServerMessage(msg);
    const decoded = JSON.parse(encoded);
    expect(decoded.type).toBe("session_status_changed");
    expect(decoded.sessionId).toBe("s1");
    expect(decoded.status).toBe("stopped");
    expect(decoded.agentType).toBe("claude");
    expect(decoded.title).toBe("Done");
  });

  it("encodes session_status_changed without optional title", () => {
    const msg: ServerSessionStatusChanged = {
      type: "session_status_changed",
      sessionId: "s2",
      status: "running",
      agentType: "opencode",
    };
    const encoded = encodeServerMessage(msg);
    const decoded = JSON.parse(encoded);
    expect(decoded.type).toBe("session_status_changed");
    expect(decoded.title).toBeUndefined();
  });
});
