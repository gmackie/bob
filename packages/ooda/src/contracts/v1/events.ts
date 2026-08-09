import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";
import { CursorPageInfoV1Schema, CursorV1Schema } from "./conversation";

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

export const AppendConversationEventResultV1Schema = z
  .object({
    event: ConversationEventV1Schema,
    replayed: z.boolean(),
  })
  .strict();

export const ConversationEventListInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    branchId: z.string().min(1).optional(),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(250).default(100),
  })
  .strict();

export const ConversationEventListPageV1Schema = z
  .object({
    items: z.array(ConversationEventV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();

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

export type AppendConversationEventResultV1 = z.infer<
  typeof AppendConversationEventResultV1Schema
>;
export type ConversationEventListInputV1 = z.infer<
  typeof ConversationEventListInputV1Schema
>;
export type ConversationEventListPageV1 = z.infer<
  typeof ConversationEventListPageV1Schema
>;
export type CorrectConversationEventInputV1 = z.infer<
  typeof CorrectConversationEventInputV1Schema
>;
