import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";

export const ConversationEventTypeV1Schema = z.enum([
  "user_turn",
  "assistant_turn",
  "assistant_delta",
  "tool_call",
  "tool_result",
  "voice_state",
  "correction",
  "citation",
  "attachment",
  "agent_job_progress",
  "proposal",
  "approval",
  "delivery",
  "external_evidence",
  "failure",
  "system_annotation",
]);

export type ConversationEventTypeV1 = z.infer<
  typeof ConversationEventTypeV1Schema
>;

export const EventActorV1Schema = z
  .object({
    type: z.enum(["user", "host", "worker", "system", "integration"]),
    id: z.string().min(1).max(256).optional(),
  })
  .strict();

export const ConversationEventV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    branchId: z.string().min(1),
    sequence: z.string().regex(/^\d+$/),
    type: ConversationEventTypeV1Schema,
    actor: EventActorV1Schema,
    payload: z.record(z.string(), z.unknown()),
    sensitivity: SensitivityV1Schema,
    correlationId: z.string().min(1).max(256),
    causationId: z.string().min(1).max(256).optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ConversationEventV1 = z.infer<
  typeof ConversationEventV1Schema
>;

export const AppendConversationEventInputV1Schema = ConversationEventV1Schema.omit(
  {
    id: true,
    sequence: true,
  },
).extend({
  idempotencyKey: z.string().min(1).max(256),
});

export type AppendConversationEventInputV1 = z.infer<
  typeof AppendConversationEventInputV1Schema
>;

export const CorrectConversationEventInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    branchId: z.string().min(1),
    correctedEventId: z.string().min(1),
    replacementPayload: z.record(z.string(), z.unknown()),
    reason: z.string().min(1).max(2_000),
    sensitivity: SensitivityV1Schema,
    correlationId: z.string().min(1).max(256),
    idempotencyKey: z.string().min(1).max(256),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();
