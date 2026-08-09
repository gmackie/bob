import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "@gmacko/ooda-client/v1";

import { readSseMessages, streamConversationEvents } from "./ooda-sse";

describe("readSseMessages", () => {
  it("parses complete named SSE messages", () => {
    const result = readSseMessages(
      'event: session_output\ndata: {"session_id":"s1","type":"stdout_chunk"}\n\n',
    );

    expect(result.rest).toBe("");
    expect(result.messages).toEqual([
      {
        event: "session_output",
        data: '{"session_id":"s1","type":"stdout_chunk"}',
      },
    ]);
  });

  it("keeps partial messages as rest", () => {
    const result = readSseMessages("event: session_output\ndata: {");

    expect(result.messages).toEqual([]);
    expect(result.rest).toBe("event: session_output\ndata: {");
  });

  it("joins multiline data fields", () => {
    const result = readSseMessages("event: message\ndata: hello\ndata: world\n\n");

    expect(result.messages).toEqual([
      {
        event: "message",
        data: "hello\nworld",
      },
    ]);
  });
});

function event(sequence: string): ConversationEventV1 {
  return {
    id: `00000000-0000-4000-8000-${sequence.padStart(12, "0")}`,
    conversationId: "00000000-0000-4000-8000-000000000100",
    branchId: "00000000-0000-4000-8000-000000000200",
    sequence,
    type: "assistant_turn",
    actor: { type: "host" },
    payload: { display: `event ${sequence}` },
    sensitivity: "general",
    correlationId: "00000000-0000-4000-8000-000000000300",
    occurredAt: "2026-08-08T12:00:00.000Z",
  };
}

function sseResponse(events: ConversationEventV1[]): Response {
  const body = events
    .map((item) => `id: ${item.sequence}\nevent: conversation_event\ndata: ${JSON.stringify(item)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streamConversationEvents", () => {
  it("reconnects from the last accepted sequence without replaying events", async () => {
    const controller = new AbortController();
    const requests: (string | undefined)[] = [];
    const received: string[] = [];
    const responses = [sseResponse([event("1")]), sseResponse([event("2")])];

    await streamConversationEvents({
      signal: controller.signal,
      reconnectDelayMs: 0,
      createRequest: (afterSequence) => {
        requests.push(afterSequence);
        return Promise.resolve({ url: "https://ooda.test/stream", headers: {} });
      },
      fetchImpl: () => Promise.resolve(responses.shift() ?? sseResponse([])),
      onEvent: (item) => {
        received.push(item.sequence);
        if (item.sequence === "2") controller.abort();
      },
    });

    expect(requests).toEqual([undefined, "1"]);
    expect(received).toEqual(["1", "2"]);
  });

  it("ignores duplicate or older sequences after reconnect", async () => {
    const controller = new AbortController();
    const received: string[] = [];

    await streamConversationEvents({
      signal: controller.signal,
      initialAfterSequence: "4",
      reconnectDelayMs: 0,
      createRequest: () => Promise.resolve({ url: "https://ooda.test/stream", headers: {} }),
      fetchImpl: () => Promise.resolve(sseResponse([event("4"), event("5")])),
      onEvent: (item) => {
        received.push(item.sequence);
        controller.abort();
      },
    });

    expect(received).toEqual(["5"]);
  });
});
