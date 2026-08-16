import type { CreateAgentJobInputV1 } from "@gmacko/ooda-client/v1";
import {
  buildConversationResearchJobInputV1,
  canAutomaticallyResearchSensitivityV1,
} from "@gmacko/ooda-client/v1";

import type { OodaMessageTimelineItem } from "./ooda-timeline";

export function canResearchConversationItem(
  item: OodaMessageTimelineItem | undefined,
): boolean {
  return Boolean(
    item?.deliveryState === "synced" &&
      item.event &&
      (item.event.type === "user_turn" ||
        item.event.type === "assistant_turn") &&
      canAutomaticallyResearchSensitivityV1(item.event.sensitivity) &&
      item.display.trim(),
  );
}

export function buildConversationResearchJobInput(input: {
  item: OodaMessageTimelineItem;
  idempotencyKey: string;
}): CreateAgentJobInputV1 {
  const event = input.item.event;
  if (!event || !input.item.display.trim())
    throw new Error("Research excerpt is required");
  if (!canResearchConversationItem(input.item)) {
    throw new Error("Research needs a durable synced conversation message");
  }

  return buildConversationResearchJobInputV1({
    conversationId: event.conversationId,
    eventId: event.id,
    role: input.item.role,
    body: input.item.display,
    sensitivity: event.sensitivity,
    correlationId: event.correlationId,
    idempotencyKey: input.idempotencyKey,
  });
}
