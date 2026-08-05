import { z } from "zod";

import { SensitivityV1Schema } from "./conversation";

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
