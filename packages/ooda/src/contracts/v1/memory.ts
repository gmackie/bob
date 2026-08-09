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
    overallScore: z.number().min(-0.25).max(1),
    recommendation: z.enum(["incubate", "propose", "merge", "dismiss", "kill"]),
    capacitySnapshot: z.record(z.string(), z.unknown()),
    opportunity: z.record(z.string(), z.unknown()),
    proposalId: z.string().min(1).optional(),
    dismissalReason: z.string().max(10_000).optional(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type AttentionReviewV1 = z.infer<typeof AttentionReviewV1Schema>;

export const OpportunityDimensionScoresV1Schema = z
  .object({
    expectedValue: z.number().min(0).max(1),
    strategicFit: z.number().min(0).max(1),
    evidence: z.number().min(0).max(1),
    timing: z.number().min(0).max(1),
    crossProjectSynergy: z.number().min(0).max(1),
    energyInterestFit: z.number().min(0).max(1),
    reversibilityLearningValue: z.number().min(0).max(1),
    opportunityCost: z.number().min(0).max(1),
  })
  .strict();

export const OpportunityCapacitySnapshotV1Schema = z
  .object({
    activeVentureExperiments: z.number().int().nonnegative(),
    majorImplementationStreams: z.number().int().nonnegative(),
    dailyRecommendedActions: z.number().int().nonnegative().default(0),
  })
  .strict();

export const OpportunityReviewDataV1Schema = z
  .object({
    problem: z.string().min(1).max(20_000),
    audience: z.string().min(1).max(10_000),
    currentWorkaround: z.string().min(1).max(20_000),
    differentiation: z.string().min(1).max(20_000),
    evidence: z.array(z.string().min(1).max(10_000)).min(1).max(100),
    strategicFit: z.string().min(1).max(20_000),
    smallestTest: z.string().min(1).max(20_000),
    effort: z.string().min(1).max(10_000),
    risks: z.array(z.string().min(1).max(10_000)).min(1).max(100),
    killCriteria: z.array(z.string().min(1).max(10_000)).min(1).max(100),
  })
  .strict();
export type OpportunityReviewDataV1 = z.infer<
  typeof OpportunityReviewDataV1Schema
>;

export const CreateOpportunityReviewInputV1Schema = z
  .object({
    memorySeedId: z.string().min(1),
    dimensionScores: OpportunityDimensionScoresV1Schema,
    uncertainty: z.number().min(0).max(1),
    capacitySnapshot: OpportunityCapacitySnapshotV1Schema,
    opportunity: OpportunityReviewDataV1Schema,
    duplicateMemoryId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).max(256),
  })
  .strict();
export type CreateOpportunityReviewInputV1 = z.infer<
  typeof CreateOpportunityReviewInputV1Schema
>;

export const CreateOpportunityReviewResultV1Schema = z
  .object({ review: AttentionReviewV1Schema, replayed: z.boolean() })
  .strict();
export type CreateOpportunityReviewResultV1 = z.infer<
  typeof CreateOpportunityReviewResultV1Schema
>;

export const GetAttentionReviewInputV1Schema = z
  .object({ reviewId: z.string().min(1) })
  .strict();
