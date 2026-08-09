import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";
import { CursorPageInfoV1Schema, CursorV1Schema } from "./conversation";

export const MemorySeedKindV1Schema = z.enum([
  "question",
  "idea",
  "observation",
  "preference",
  "claim",
  "decision",
  "commitment",
  "correction",
]);
export type MemorySeedKindV1 = z.infer<typeof MemorySeedKindV1Schema>;

export const MemoryLifecycleStateV1Schema = z.enum([
  "captured",
  "enriched",
  "incubating",
  "proposed",
  "committed",
  "completed",
  "reflected",
  "dismissed",
  "merged",
  "killed",
]);

export const MemorySeedV1Schema = z
  .object({
    id: z.string().min(1),
    conversationId: z.string().min(1),
    kind: MemorySeedKindV1Schema,
    sourceEventId: z.string().min(1),
    sourceSpan: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      })
      .strict()
      .refine((span) => span.end > span.start, {
        message: "Source span end must be greater than start",
      }),
    normalizedText: z.string().min(1).max(100_000),
    entities: z.array(z.string().min(1).max(512)).max(500),
    sensitivity: SensitivityV1Schema,
    confidence: z.number().min(0).max(1),
    lifecycleState: MemoryLifecycleStateV1Schema,
    supersededById: z.string().min(1).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type MemorySeedV1 = z.infer<typeof MemorySeedV1Schema>;

export const MemoryEdgeKindV1Schema = z.enum([
  "semantic",
  "entity",
  "temporal",
  "causal",
  "supports",
  "conflicts",
  "supersedes",
  "external",
]);

export const MemoryEdgeV1Schema = z
  .object({
    id: z.string().min(1),
    fromMemoryId: z.string().min(1),
    toMemoryId: z.string().min(1),
    kind: MemoryEdgeKindV1Schema,
    score: z.number().min(0).max(1),
    explanation: z.string().min(1).max(10_000),
    discoveryMethod: z.string().min(1).max(128),
    feedbackState: z.enum(["unreviewed", "confirmed", "suppressed"]),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type MemoryEdgeV1 = z.infer<typeof MemoryEdgeV1Schema>;

export const MemorySearchInputV1Schema = z
  .object({
    query: z.string().max(10_000).optional(),
    conversationId: z.string().min(1).optional(),
    lifecycleState: MemoryLifecycleStateV1Schema.optional(),
    includeSuperseded: z.boolean().default(false),
    cursor: CursorV1Schema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MemorySearchInputV1 = z.infer<typeof MemorySearchInputV1Schema>;

export const MemorySearchPageV1Schema = z
  .object({
    items: z.array(MemorySeedV1Schema),
    pageInfo: CursorPageInfoV1Schema,
  })
  .strict();
export type MemorySearchPageV1 = z.infer<typeof MemorySearchPageV1Schema>;

export const InspectMemoryInputV1Schema = z
  .object({ memoryId: z.string().min(1) })
  .strict();

export const MemoryConnectionV1Schema = z
  .object({
    direction: z.enum(["outgoing", "incoming"]),
    edge: MemoryEdgeV1Schema,
    memory: MemorySeedV1Schema,
  })
  .strict();

export const MemoryDetailV1Schema = z
  .object({
    memory: MemorySeedV1Schema,
    connections: z.array(MemoryConnectionV1Schema).max(500),
  })
  .strict();
export type MemoryDetailV1 = z.infer<typeof MemoryDetailV1Schema>;

export const SubmitMemoryFeedbackInputV1Schema = z
  .object({
    edgeId: z.string().min(1),
    feedbackState: z.enum(["confirmed", "suppressed"]),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();
export type SubmitMemoryFeedbackInputV1 = z.infer<
  typeof SubmitMemoryFeedbackInputV1Schema
>;

export const SubmitMemoryFeedbackResultV1Schema = z
  .object({ edge: MemoryEdgeV1Schema, replayed: z.boolean() })
  .strict();
export type SubmitMemoryFeedbackResultV1 = z.infer<
  typeof SubmitMemoryFeedbackResultV1Schema
>;

export const AttentionReviewV1Schema = z
  .object({
    id: z.string().min(1),
    memorySeedId: z.string().min(1),
    dimensionScores: z.record(z.string(), z.number().min(-1).max(1)),
    uncertainty: z.number().min(0).max(1),
    recommendation: z.enum(["incubate", "propose", "merge", "dismiss", "kill"]),
    capacitySnapshot: z.record(z.string(), z.unknown()),
    proposalId: z.string().min(1).optional(),
    dismissalReason: z.string().max(10_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AttentionReviewV1 = z.infer<typeof AttentionReviewV1Schema>;
