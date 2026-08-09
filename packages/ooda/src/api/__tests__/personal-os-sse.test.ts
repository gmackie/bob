import { describe, expect, it } from "vitest";

import type { ConversationEventV1 } from "../../contracts/v1";
import {
  createConversationEventStreamResponse,
  encodeConversationEventSse,
  resolveAfterSequence,
} from "../conversation-event-stream";

function event(sequence: string): ConversationEventV1 {
  return {
    id: `event-${sequence}`,
    conversationId: "conversation-1",
    branchId: "branch-1",
    sequence,
    type: "assistant_turn",
    actor: { type: "host", id: "grok" },
    payload: { display: `reply-${sequence}` },
    sensitivity: "general",
    correlationId: "stream-test",
    occurredAt: "2026-08-05T18:00:00.000Z",
  };
}

describe("resumable conversation SSE", () => {
  it("prefers Last-Event-ID and validates decimal cursors", () => {
    expect(
      resolveAfterSequence(
        new Request("https://ooda.test/stream?afterSequence=4", {
          headers: { "Last-Event-ID": "9" },
        }),
      ),
    ).toBe("9");
    expect(
      resolveAfterSequence(new Request("https://ooda.test/stream?afterSequence=4")),
    ).toBe("4");
    expect(() =>
      resolveAfterSequence(new Request("https://ooda.test/stream?afterSequence=4.2")),
    ).toThrow(/afterSequence/i);
  });

  it("uses canonical sequence as the SSE event ID", () => {
    expect(encodeConversationEventSse(event("42"))).toContain(
      "id: 42\nevent: conversation_event\ndata:",
    );
  });

  it("catches up, advances its cursor, and closes cleanly for edge recycling", async () => {
    const calls: string[] = [];
    const response = createConversationEventStreamResponse({
      request: new Request("https://ooda.test/stream?afterSequence=1"),
      maxDurationMs: 35,
      pollIntervalMs: 5,
      heartbeatIntervalMs: 10,
      readEvents: async (afterSequence) => {
        calls.push(afterSequence);
        return afterSequence === "1" ? [event("2"), event("3")] : [];
      },
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body.match(/id: 2/g)).toHaveLength(1);
    expect(body.match(/id: 3/g)).toHaveLength(1);
    expect(calls[0]).toBe("1");
    expect(calls).toContain("3");
  });
});
