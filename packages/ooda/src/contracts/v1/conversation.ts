import { z } from "zod";

export const SensitivityV1Schema = z.enum([
  "general",
  "personal",
  "sensitive",
  "restricted",
]);

export type SensitivityV1 = z.infer<typeof SensitivityV1Schema>;

export const ConversationStatusV1Schema = z.enum(["active", "archived"]);

export const TtsPolicyV1Schema = z.enum([
  "allowed",
  "manual",
  "disabled",
  "sensitive_denied",
]);

export const ConversationV1Schema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    title: z.string().min(1).max(256),
    status: ConversationStatusV1Schema,
    hostProvider: z.string().min(1).max(64),
    hostProfile: z.string().min(1).max(128),
    activeBranchId: z.string().min(1),
    lastSequence: z.string().regex(/^\d+$/),
    sensitivityCeiling: SensitivityV1Schema,
    ttsPolicy: TtsPolicyV1Schema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ConversationV1 = z.infer<typeof ConversationV1Schema>;

export const ConversationBranchV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    parentBranchId: z.string().min(1).optional(),
    forkEventId: z.string().min(1).optional(),
    name: z.string().min(1).max(256),
    reason: z.string().max(2_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ConversationBranchV1 = z.infer<
  typeof ConversationBranchV1Schema
>;

export const CreateConversationInputV1Schema = z
  .object({
    title: z.string().min(1).max(256),
    hostProvider: z.string().min(1).max(64).default("grok"),
    hostProfile: z.string().min(1).max(128).default("daily"),
    sensitivityCeiling: SensitivityV1Schema.default("personal"),
    ttsPolicy: TtsPolicyV1Schema.default("allowed"),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export type CreateConversationInputV1 = z.infer<
  typeof CreateConversationInputV1Schema
>;

export const CursorV1Schema = z.string().min(1).max(1_024);

export const CursorPageInfoV1Schema = z
  .object({
    nextCursor: CursorV1Schema.optional(),
    hasMore: z.boolean(),
  })
  .strict();

export type CursorPageInfoV1 = z.infer<typeof CursorPageInfoV1Schema>;
