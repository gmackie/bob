import {
  AppendConversationEventResultV1Schema,
  HermesCaptureInputV1Schema,
  HermesCaptureReceiptV1Schema,
  type AppendConversationEventInputV1,
  type AppendConversationEventResultV1,
  type HermesCaptureInputV1,
  type HermesCaptureReceiptV1,
} from "../contracts/v1";

export interface HermesCaptureWriter {
  append(
    input: AppendConversationEventInputV1,
  ): Promise<AppendConversationEventResultV1>;
}

export interface HermesCaptureAdapter {
  capture(input: HermesCaptureInputV1): Promise<HermesCaptureReceiptV1>;
}

export function createHermesCaptureAdapter(
  writer: HermesCaptureWriter,
): HermesCaptureAdapter {
  return {
    async capture(input) {
      const command = HermesCaptureInputV1Schema.parse(input);
      const result = AppendConversationEventResultV1Schema.parse(
        await writer.append({
          conversationId: command.conversationId,
          branchId: command.branchId,
          type: "external_evidence",
          actor: { type: "integration", id: "hermes" },
          payload: {
            format: "text",
            text: command.text,
            source: "hermes",
          },
          sensitivity: "personal",
          correlationId: command.requestId,
          idempotencyKey: command.requestId,
          occurredAt: command.occurredAt,
        }),
      );
      return HermesCaptureReceiptV1Schema.parse({
        schemaVersion: 1,
        requestId: command.requestId,
        replayed: result.replayed,
        canonicalRef: {
          kind: "conversation_event",
          id: result.event.id,
        },
        occurredAt: result.event.occurredAt,
      });
    },
  };
}
