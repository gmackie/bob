import { describe, expect, it } from "vitest";

import {
  collapseBobEventsToMessages,
  collapseOodaEventsToMessages,
  isPromotableMessage,
} from "./chat-messages";

describe("chat message mapping", () => {
  it("collapses Bob input and streaming output events into shared messages", () => {
    const messages = collapseBobEventsToMessages([
      {
        sessionId: "bob-session",
        seq: 1,
        eventType: "input",
        direction: "client",
        payload: { content: "What changed?" },
        createdAt: "2026-05-13T12:00:00.000Z",
      },
      {
        sessionId: "bob-session",
        seq: 2,
        eventType: "output_chunk",
        direction: "agent",
        payload: { chunk: "Auth " },
        createdAt: "2026-05-13T12:00:01.000Z",
      },
      {
        sessionId: "bob-session",
        seq: 3,
        eventType: "output_chunk",
        direction: "agent",
        payload: { chunk: "is ready." },
        createdAt: "2026-05-13T12:00:02.000Z",
      },
    ]);

    expect(messages).toEqual([
      {
        id: "bob:bob-session:1",
        mode: "bob",
        role: "user",
        content: "What changed?",
        timestamp: "2026-05-13T12:00:00.000Z",
        sourceId: "bob-session",
      },
      {
        id: "bob:bob-session:2",
        mode: "bob",
        role: "assistant",
        content: "Auth is ready.",
        timestamp: "2026-05-13T12:00:01.000Z",
        sourceId: "bob-session",
      },
    ]);
  });

  it("collapses OODA prompt and stdout events into shared messages", () => {
    const messages = collapseOodaEventsToMessages("ooda-session", [
      {
        id: "event-1",
        sessionId: "ooda-session",
        type: "prompt",
        content: "Find notes about auth migrations",
        createdAt: "2026-05-13T12:10:00.000Z",
      },
      {
        id: "event-2",
        sessionId: "ooda-session",
        type: "stdout_chunk",
        content: "Three notes ",
        createdAt: "2026-05-13T12:10:01.000Z",
      },
      {
        id: "event-3",
        sessionId: "ooda-session",
        type: "stdout_chunk",
        content: "match.",
        createdAt: "2026-05-13T12:10:02.000Z",
      },
    ]);

    expect(messages).toEqual([
      {
        id: "ooda:ooda-session:event-1",
        mode: "ooda",
        role: "user",
        content: "Find notes about auth migrations",
        timestamp: "2026-05-13T12:10:00.000Z",
        sourceId: "ooda-session",
      },
      {
        id: "ooda:ooda-session:event-2",
        mode: "ooda",
        role: "assistant",
        content: "Three notes match.",
        timestamp: "2026-05-13T12:10:01.000Z",
        sourceId: "ooda-session",
      },
    ]);
  });

  it("only shows promotion actions for OODA assistant responses", () => {
    expect(
      isPromotableMessage({
        id: "1",
        mode: "ooda",
        role: "assistant",
        content: "A finding",
        timestamp: "2026-05-13T12:00:00.000Z",
        sourceId: "ooda-session",
      }),
    ).toBe(true);
    expect(
      isPromotableMessage({
        id: "2",
        mode: "bob",
        role: "assistant",
        content: "A Bob update",
        timestamp: "2026-05-13T12:00:00.000Z",
        sourceId: "bob-session",
      }),
    ).toBe(false);
  });
});
