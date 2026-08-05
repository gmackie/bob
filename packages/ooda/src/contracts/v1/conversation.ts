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

export const ConversationListInputV1Schema = z
  .object({
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    status: ConversationStatusV1Schema.optional(),
    query: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export const ConversationListPageV1Schema = z
  .object({
    items: z.array(ConversationV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();

export const ConversationDetailV1Schema = z
  .object({
    conversation: ConversationV1Schema,
    branches: z.array(ConversationBranchV1Schema),
  })
  .strict();

export const CreateConversationResultV1Schema = z
  .object({
    conversation: ConversationV1Schema,
    branch: ConversationBranchV1Schema,
    replayed: z.boolean(),
  })
  .strict();

export const ForkConversationInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    parentBranchId: z.string().min(1),
    forkEventId: z.string().min(1),
    name: z.string().min(1).max(256),
    reason: z.string().max(2_000).optional(),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export const ForkConversationResultV1Schema = z
  .object({
    branch: ConversationBranchV1Schema,
    replayed: z.boolean(),
  })
  .strict();

export const ArchiveConversationInputV1Schema = z
  .object({
    conversationId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();

export const ArchiveConversationResultV1Schema = z
  .object({
    conversation: ConversationV1Schema,
    replayed: z.boolean(),
  })
  .strict();

export type ConversationListInputV1 = z.infer<
  typeof ConversationListInputV1Schema
>;
export type ConversationListPageV1 = z.infer<
  typeof ConversationListPageV1Schema
>;
export type ConversationDetailV1 = z.infer<typeof ConversationDetailV1Schema>;
export type CreateConversationResultV1 = z.infer<
  typeof CreateConversationResultV1Schema
>;
export type ForkConversationInputV1 = z.infer<
  typeof ForkConversationInputV1Schema
>;
export type ForkConversationResultV1 = z.infer<
  typeof ForkConversationResultV1Schema
>;
export type ArchiveConversationInputV1 = z.infer<
  typeof ArchiveConversationInputV1Schema
>;
export type ArchiveConversationResultV1 = z.infer<
  typeof ArchiveConversationResultV1Schema
>;
