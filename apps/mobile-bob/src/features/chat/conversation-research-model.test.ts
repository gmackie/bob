import type { ConversationEventV1 } from "@gmacko/ooda-client/v1";
import { describe, expect, it } from "vitest";

import type { OodaMessageTimelineItem } from "./ooda-timeline";
import {
  buildConversationResearchJobInput,
  canResearchConversationItem,
} from "./conversation-research-model";

function assistantItem(): OodaMessageTimelineItem {
  const event: ConversationEventV1 = {
    id: "event-assistant-1",
    conversationId: "conversation-1",
    branchId: "branch-main",
    sequence: "8",
    type: "assistant_turn",
    actor: { type: "host", id: "grok" },
    payload: { display: "A battery-backed device could solve this." },
    sensitivity: "personal",
    correlationId: "turn-4",
    occurredAt: "2026-08-16T19:00:00.000Z",
  };
  return {
    id: event.id,
    kind: "message",
    role: "assistant",
    display: String(event.payload.display),
    timestamp: event.occurredAt,
    sensitivity: event.sensitivity,
    deliveryState: "synced",
    event,
  };
}

describe("mobile conversation research model", () => {
  it("builds only a server-governed read-only research request", () => {
    const item = assistantItem();
    const input = buildConversationResearchJobInput({
      item,
      idempotencyKey: "research-device-1",
    });

    expect(input).toEqual({
      conversationId: "conversation-1",
      class: "read_only_research",
      prompt:
        "Research the following durable OODA conversation excerpt. Return concise findings, uncertainty, and source links. Do not modify repositories or external systems.\n\nSource role: assistant\nSource event: event-assistant-1\n\nA battery-backed device could solve this.",
      correlationId: "turn-4",
      idempotencyKey: "research-device-1",
    });
    expect(input).not.toHaveProperty("provider");
    expect(input).not.toHaveProperty("capabilities");
    expect(input).not.toHaveProperty("budget");
  });

  it("allows research only from a durable synced message", () => {
    expect(canResearchConversationItem(assistantItem())).toBe(true);
    expect(
      canResearchConversationItem({
        ...assistantItem(),
        deliveryState: "streaming",
      }),
    ).toBe(false);
    expect(
      canResearchConversationItem({ ...assistantItem(), event: undefined }),
    ).toBe(false);
  });

  it("rejects a blank excerpt", () => {
    expect(() =>
      buildConversationResearchJobInput({
        item: { ...assistantItem(), display: "   " },
        idempotencyKey: "research-device-2",
      }),
    ).toThrow("Research excerpt is required");
  });
});
