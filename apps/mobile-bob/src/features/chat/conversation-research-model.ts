import type { CreateAgentJobInputV1 } from "@gmacko/ooda-client/v1";

import type { OodaMessageTimelineItem } from "./ooda-timeline";

export function canResearchConversationItem(
  item: OodaMessageTimelineItem | undefined,
): boolean {
  return Boolean(
    item?.deliveryState === "synced" &&
      item.event &&
      (item.event.type === "user_turn" ||
        item.event.type === "assistant_turn") &&
      item.display.trim(),
  );
}

export function buildConversationResearchJobInput(input: {
  item: OodaMessageTimelineItem;
  idempotencyKey: string;
}): CreateAgentJobInputV1 {
  const event = input.item.event;
  const excerpt = input.item.display.trim().slice(0, 50_000);
  if (!event || !excerpt) throw new Error("Research excerpt is required");
  if (!canResearchConversationItem(input.item)) {
    throw new Error("Research needs a durable synced conversation message");
  }

  return {
    conversationId: event.conversationId,
    class: "read_only_research",
    prompt: [
      "Research the following durable OODA conversation excerpt. Return concise findings, uncertainty, and source links. Do not modify repositories or external systems.",
      `Source role: ${input.item.role}\nSource event: ${event.id}`,
      excerpt,
    ].join("\n\n"),
    correlationId: event.correlationId,
    idempotencyKey: input.idempotencyKey,
  };
}
