import type {
  ConversationEventV1,
  CorrectConversationEventInputV1,
} from "@gmacko/ooda-client/v1";

export function canCorrectConversationEvent(
  event: ConversationEventV1 | undefined,
): event is ConversationEventV1 {
  return event?.type === "user_turn";
}

export function buildConversationCorrectionInput(input: {
  event: ConversationEventV1;
  text: string;
  reason: string;
  idempotencyKey: string;
  occurredAt: string;
}): CorrectConversationEventInputV1 {
  if (!canCorrectConversationEvent(input.event)) {
    throw new Error("Only saved user turns can be corrected");
  }
  const text = input.text.trim();
  if (!text) throw new Error("Correction text is required");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Correction reason is required");

  return {
    conversationId: input.event.conversationId,
    branchId: input.event.branchId,
    correctedEventId: input.event.id,
    replacementPayload: {
      ...input.event.payload,
      display: text,
      text,
    },
    reason,
    sensitivity: input.event.sensitivity,
    correlationId: input.event.correlationId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
  };
}
