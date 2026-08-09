import { describe, expect, it } from "vitest";

import { translateLegacyResearchConversation } from "../legacy-compatibility";

describe("legacy research compatibility", () => {
  it("translates a legacy thread and sessions without changing source IDs", () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    const result = translateLegacyResearchConversation({
      thread: {
        id: "11111111-1111-4111-8111-111111111111",
        ownerId: "owner-a",
        title: "Legacy research",
        status: "active",
        createdAt,
        updatedAt: new Date("2026-08-02T12:00:00.000Z"),
      },
      events: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          sessionId: "22222222-2222-4222-8222-222222222222",
          adapterId: "claude",
          type: "stdout",
          content: "Research result",
          createdAt: new Date("2026-08-01T12:02:00.000Z"),
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          sessionId: "22222222-2222-4222-8222-222222222222",
          adapterId: "claude",
          type: "prompt",
          content: "Research this",
          createdAt: new Date("2026-08-01T12:01:00.000Z"),
        },
      ],
    });

    expect(result.detail.conversation.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(result.detail.conversation.lastSequence).toBe("3");
    expect(result.events.map((item) => item.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "44444444-4444-4444-8444-444444444444",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(result.events.map((item) => item.type)).toEqual([
      "system_annotation",
      "user_turn",
      "assistant_turn",
    ]);
    expect(result.events[1]?.payload).toMatchObject({
      content: "Research this",
      migration: {
        source: "session_event",
        sourceId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });
});
