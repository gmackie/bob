import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "@gmacko/ooda/contracts/v1";

import { readSseMessages, streamConversationEvents } from "./stream";

describe("readSseMessages", () => {
  it("preserves partial frames and joins multiline data", () => {
    expect(
      readSseMessages("event: message\ndata: hello\ndata: world\n\n"),
    ).toEqual({
      messages: [{ event: "message", data: "hello\nworld" }],
      rest: "",
    });
    expect(readSseMessages("event: message\ndata: {")).toEqual({
      messages: [],
      rest: "event: message\ndata: {",
    });
  });
});

function event(sequence: string): ConversationEventV1 {
  return {
    id: `event-${sequence}`,
    conversationId: "conversation-1",
    branchId: "branch-1",
    sequence,
    type: "assistant_turn",
    actor: { type: "host" },
    payload: { display: `event ${sequence}` },
    sensitivity: "general",
    correlationId: "host-turn",
    occurredAt: "2026-08-09T12:00:00.000Z",
  };
}

function response(events: ConversationEventV1[]): Response {
  return new Response(
    events
      .map(
        (item) =>
          `id: ${item.sequence}\nevent: conversation_event\ndata: ${JSON.stringify(item)}\n\n`,
      )
      .join(""),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("streamConversationEvents", () => {
  it("resumes from the last accepted sequence and rejects replayed frames", async () => {
    const controller = new AbortController();
    const requests: (string | undefined)[] = [];
    const received: string[] = [];
    const responses = [
      response([event("1")]),
      response([event("1"), event("2")]),
    ];

    await streamConversationEvents({
      signal: controller.signal,
      reconnectDelayMs: 0,
      createRequest: (afterSequence) => {
        requests.push(afterSequence);
        return Promise.resolve({
          url: "https://ooda.test/stream",
          headers: {},
        });
      },
      fetchImpl: () => Promise.resolve(responses.shift() ?? response([])),
      onEvent: (item) => {
        received.push(item.sequence);
        if (item.sequence === "2") controller.abort();
      },
    });

    expect(requests).toEqual([undefined, "1"]);
    expect(received).toEqual(["1", "2"]);
  });
});
