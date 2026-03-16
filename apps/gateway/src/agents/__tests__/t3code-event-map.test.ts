import { describe, it, expect } from "vitest";
import { bobEventToT3, t3EventToBob } from "../t3code-event-map.js";
import type { ServerEvent } from "../../ws/protocol.js";
import type { T3DomainEvent } from "../t3code-event-map.js";

const THREAD_ID = "thread-1";

function makeEvent(
  eventType: ServerEvent["eventType"],
  direction: ServerEvent["direction"],
  payload: Record<string, unknown>,
): ServerEvent {
  return {
    type: "event",
    sessionId: "sess-1",
    seq: 1,
    eventType,
    direction,
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe("bobEventToT3", () => {
  it("maps output_chunk → conversation.textDelta", () => {
    const event = makeEvent("output_chunk", "agent", { data: "Hello world" });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "conversation.textDelta",
      threadId: THREAD_ID,
      content: "Hello world",
    });
  });

  it("returns null for output_chunk with non-agent direction", () => {
    const event = makeEvent("output_chunk", "system", { data: "sys output" });
    expect(bobEventToT3(event, THREAD_ID)).toBeNull();
  });

  it("maps tool_call → conversation.toolCall", () => {
    const event = makeEvent("tool_call", "agent", {
      toolCallId: "tc-1",
      name: "read_file",
      arguments: '{"path":"README.md"}',
    });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "conversation.toolCall",
      threadId: THREAD_ID,
      toolCallId: "tc-1",
      name: "read_file",
      arguments: '{"path":"README.md"}',
    });
  });

  it("maps tool_result → conversation.toolResult", () => {
    const event = makeEvent("tool_result", "agent", {
      toolCallId: "tc-1",
      result: "file content here",
      isError: false,
    });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "conversation.toolResult",
      threadId: THREAD_ID,
      toolCallId: "tc-1",
      result: "file content here",
      isError: false,
    });
  });

  it("maps state → session.statusChange", () => {
    const event = makeEvent("state", "system", { status: "running" });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "session.statusChange",
      threadId: THREAD_ID,
      status: "running",
    });
  });

  it("maps stopping status to stopped", () => {
    const event = makeEvent("state", "system", { status: "stopping" });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "session.statusChange",
      threadId: THREAD_ID,
      status: "stopped",
    });
  });

  it("maps input (client) → conversation.userMessage", () => {
    const event = makeEvent("input", "client", { data: "user message" });
    const result = bobEventToT3(event, THREAD_ID);
    expect(result).toEqual({
      type: "conversation.userMessage",
      threadId: THREAD_ID,
      content: "user message",
    });
  });

  it("returns null for input with non-client direction", () => {
    const event = makeEvent("input", "agent", { data: "agent input" });
    expect(bobEventToT3(event, THREAD_ID)).toBeNull();
  });

  it("returns null for heartbeat events", () => {
    const event = makeEvent("heartbeat", "system", { ts: new Date().toISOString() });
    expect(bobEventToT3(event, THREAD_ID)).toBeNull();
  });

  it("returns null for error events", () => {
    const event = makeEvent("error", "system", { code: "ERR", message: "bad" });
    expect(bobEventToT3(event, THREAD_ID)).toBeNull();
  });
});

describe("t3EventToBob", () => {
  it("maps conversation.textDelta → output_chunk", () => {
    const t3: T3DomainEvent = {
      type: "conversation.textDelta",
      threadId: THREAD_ID,
      content: "Hello",
    };
    expect(t3EventToBob(t3)).toEqual({
      eventType: "output_chunk",
      direction: "agent",
      payload: { data: "Hello" },
    });
  });

  it("maps conversation.toolCall → tool_call", () => {
    const t3: T3DomainEvent = {
      type: "conversation.toolCall",
      threadId: THREAD_ID,
      toolCallId: "tc-2",
      name: "write_file",
      arguments: '{"path":"a.txt","content":"hi"}',
    };
    expect(t3EventToBob(t3)).toEqual({
      eventType: "tool_call",
      direction: "agent",
      payload: {
        toolCallId: "tc-2",
        name: "write_file",
        arguments: '{"path":"a.txt","content":"hi"}',
      },
    });
  });

  it("maps conversation.toolResult → tool_result", () => {
    const t3: T3DomainEvent = {
      type: "conversation.toolResult",
      threadId: THREAD_ID,
      toolCallId: "tc-2",
      result: "written",
      isError: false,
    };
    expect(t3EventToBob(t3)).toEqual({
      eventType: "tool_result",
      direction: "agent",
      payload: {
        toolCallId: "tc-2",
        result: "written",
        isError: false,
      },
    });
  });

  it("maps conversation.userMessage → input", () => {
    const t3: T3DomainEvent = {
      type: "conversation.userMessage",
      threadId: THREAD_ID,
      content: "do something",
    };
    expect(t3EventToBob(t3)).toEqual({
      eventType: "input",
      direction: "client",
      payload: { data: "do something" },
    });
  });

  it("maps session.statusChange → state", () => {
    const t3: T3DomainEvent = {
      type: "session.statusChange",
      threadId: THREAD_ID,
      status: "error",
    };
    expect(t3EventToBob(t3)).toEqual({
      eventType: "state",
      direction: "system",
      payload: { status: "error" },
    });
  });
});

describe("round-trip", () => {
  it("bobEventToT3 then t3EventToBob preserves data for output_chunk", () => {
    const original = makeEvent("output_chunk", "agent", { data: "round trip text" });
    const t3 = bobEventToT3(original, THREAD_ID)!;
    expect(t3).not.toBeNull();
    const bob = t3EventToBob(t3)!;
    expect(bob).not.toBeNull();
    expect(bob.eventType).toBe("output_chunk");
    expect(bob.direction).toBe("agent");
    expect(bob.payload.data).toBe("round trip text");
  });

  it("bobEventToT3 then t3EventToBob preserves data for tool_call", () => {
    const original = makeEvent("tool_call", "agent", {
      toolCallId: "tc-rt",
      name: "exec",
      arguments: '{"cmd":"ls"}',
    });
    const t3 = bobEventToT3(original, THREAD_ID)!;
    const bob = t3EventToBob(t3)!;
    expect(bob.eventType).toBe("tool_call");
    expect(bob.payload.toolCallId).toBe("tc-rt");
    expect(bob.payload.name).toBe("exec");
    expect(bob.payload.arguments).toBe('{"cmd":"ls"}');
  });

  it("bobEventToT3 then t3EventToBob preserves data for tool_result", () => {
    const original = makeEvent("tool_result", "agent", {
      toolCallId: "tc-rt",
      result: "output",
      isError: true,
    });
    const t3 = bobEventToT3(original, THREAD_ID)!;
    const bob = t3EventToBob(t3)!;
    expect(bob.eventType).toBe("tool_result");
    expect(bob.payload.toolCallId).toBe("tc-rt");
    expect(bob.payload.result).toBe("output");
    expect(bob.payload.isError).toBe(true);
  });
});
