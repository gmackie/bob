import { and, eq, sql } from "drizzle-orm";

import type {
  AttentionReviewV1,
  CreateOpportunityReviewInputV1,
  CreateOpportunityReviewResultV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversationEvents, conversations } from "../db/schema/conversations";
import { attentionReviews, memoryEdges, memorySeeds } from "../db/schema/memory";
import { idempotencyConflict, notFound } from "./problems";
import { isUniqueViolation, stableStringify } from "./serialization";

type OodaDatabase = typeof database;

export interface OpportunityDimensionScores {
  expectedValue: number;
  strategicFit: number;
  evidence: number;
  timing: number;
  crossProjectSynergy: number;
  energyInterestFit: number;
  reversibilityLearningValue: number;
  opportunityCost: number;
}

export interface OpportunityCapacitySnapshot {
  activeVentureExperiments: number;
  majorImplementationStreams: number;
}

export type OpportunityRecommendation =
  | "incubate"
  | "propose"
  | "merge"
  | "dismiss"
  | "kill";

export function scoreOpportunityReview(
  scores: OpportunityDimensionScores,
  capacity: OpportunityCapacitySnapshot,
  options: { duplicateMemoryId?: string } = {},
): { score: number; recommendation: OpportunityRecommendation } {
  const raw =
    scores.expectedValue * 0.25 +
    scores.strategicFit * 0.2 +
    scores.evidence * 0.15 +
    scores.timing * 0.1 +
    scores.crossProjectSynergy * 0.1 +
    scores.energyInterestFit * 0.1 +
    scores.reversibilityLearningValue * 0.1 -
    scores.opportunityCost * 0.25;
  const score = Math.round(Math.max(-0.25, Math.min(1, raw)) * 10_000) / 10_000;

  if (options.duplicateMemoryId) return { score, recommendation: "merge" };
  if (score <= 0.15) return { score, recommendation: "kill" };
  if (score <= 0.35) return { score, recommendation: "dismiss" };
  if (
    score >= 0.7 &&
    capacity.activeVentureExperiments < 3 &&
    capacity.majorImplementationStreams < 2
  ) {
    return { score, recommendation: "propose" };
  }
  return { score, recommendation: "incubate" };
}

function mapAttentionReview(
  row: typeof attentionReviews.$inferSelect,
): AttentionReviewV1 {
  return {
    id: row.id,
    memorySeedId: row.memorySeedId,
    dimensionScores: row.dimensionScores,
    uncertainty: row.uncertainty,
    overallScore: row.overallScore,
    recommendation: row.recommendation as AttentionReviewV1["recommendation"],
    capacitySnapshot: row.capacitySnapshot,
    opportunity: row.opportunity,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    ...(row.dismissalReason ? { dismissalReason: row.dismissalReason } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

async function findReviewReplay(
  db: OodaDatabase,
  ownerId: string,
  input: CreateOpportunityReviewInputV1,
): Promise<CreateOpportunityReviewResultV1 | null> {
  const [row] = await db
    .select({ review: attentionReviews })
    .from(attentionReviews)
    .innerJoin(memorySeeds, eq(memorySeeds.id, attentionReviews.memorySeedId))
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, memorySeeds.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(
      and(
        eq(attentionReviews.memorySeedId, input.memorySeedId),
        eq(attentionReviews.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.review.commandFingerprint !== stableStringify(input)) {
    throw idempotencyConflict();
  }
  return { review: mapAttentionReview(row.review), replayed: true };
}

export async function createOpportunityReview(
  db: OodaDatabase,
  ownerId: string,
  input: CreateOpportunityReviewInputV1,
): Promise<CreateOpportunityReviewResultV1> {
  const replay = await findReviewReplay(db, ownerId, input);
  if (replay) return replay;
  const scored = scoreOpportunityReview(
    input.dimensionScores,
    input.capacitySnapshot,
    { duplicateMemoryId: input.duplicateMemoryId },
  );
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ memory: memorySeeds, branchId: conversations.activeBranchId })
        .from(memorySeeds)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, memorySeeds.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .where(eq(memorySeeds.id, input.memorySeedId))
        .for("update")
        .limit(1);
      if (!owned?.branchId) throw notFound("Memory");

      if (input.duplicateMemoryId) {
        const [duplicate] = await tx
          .select({ id: memorySeeds.id })
          .from(memorySeeds)
          .innerJoin(
            conversations,
            and(
              eq(conversations.id, memorySeeds.conversationId),
              eq(conversations.ownerId, ownerId),
            ),
          )
          .where(eq(memorySeeds.id, input.duplicateMemoryId))
          .limit(1);
        if (!duplicate || duplicate.id === input.memorySeedId) {
          throw notFound("Duplicate memory");
        }
      }

      const [review] = await tx
        .insert(attentionReviews)
        .values({
          memorySeedId: input.memorySeedId,
          dimensionScores: input.dimensionScores,
          uncertainty: input.uncertainty,
          overallScore: scored.score,
          recommendation: scored.recommendation,
          capacitySnapshot: input.capacitySnapshot,
          opportunity: input.opportunity,
          idempotencyKey: input.idempotencyKey,
          commandFingerprint: stableStringify(input),
          ...(scored.recommendation === "dismiss" || scored.recommendation === "kill"
            ? { dismissalReason: `Opportunity review recommended ${scored.recommendation}.` }
            : {}),
          createdAt: now,
        })
        .returning();
      if (!review) throw new Error("Opportunity review insert returned no row");

      const lifecycleState = scored.recommendation === "kill"
        ? "killed" as const
        : scored.recommendation === "dismiss"
          ? "dismissed" as const
          : scored.recommendation === "merge"
            ? "merged" as const
            : "incubating" as const;
      await tx
        .update(memorySeeds)
        .set({
          lifecycleState,
          ...(input.duplicateMemoryId
            ? { supersededById: input.duplicateMemoryId }
            : {}),
          updatedAt: now,
        })
        .where(eq(memorySeeds.id, input.memorySeedId));
      if (input.duplicateMemoryId) {
        await tx
          .insert(memoryEdges)
          .values({
            fromMemoryId: input.memorySeedId,
            toMemoryId: input.duplicateMemoryId,
            kind: "semantic",
            score: 1,
            explanation: "Opportunity review identified these memories as the same opportunity.",
            discoveryMethod: "opportunity_review_merge",
            feedbackState: "confirmed",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }

      const [allocated] = await tx
        .update(conversations)
        .set({
          lastSequence: sql`${conversations.lastSequence} + 1`,
          updatedAt: now,
        })
        .where(eq(conversations.id, owned.memory.conversationId))
        .returning({ sequence: conversations.lastSequence });
      await tx.insert(conversationEvents).values({
        conversationId: owned.memory.conversationId,
        branchId: owned.branchId,
        sequence: BigInt(allocated!.sequence),
        type: "system_annotation",
        actorType: "system",
        actorId: "ooda",
        payload: {
          kind: "opportunity_review",
          reviewId: review.id,
          memorySeedId: input.memorySeedId,
          score: scored.score,
          recommendation: scored.recommendation,
        },
        sensitivity: owned.memory.sensitivity,
        correlationId: review.id,
        idempotencyKey: `opportunity-review:${input.idempotencyKey}`,
        occurredAt: now,
      });
      return { review: mapAttentionReview(review), replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrentReplay = await findReviewReplay(db, ownerId, input);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}

export async function getAttentionReview(
  db: OodaDatabase,
  ownerId: string,
  reviewId: string,
): Promise<AttentionReviewV1> {
  const [row] = await db
    .select({ review: attentionReviews })
    .from(attentionReviews)
    .innerJoin(memorySeeds, eq(memorySeeds.id, attentionReviews.memorySeedId))
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, memorySeeds.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(attentionReviews.id, reviewId))
    .limit(1);
  if (!row) throw notFound("Opportunity review");
  return mapAttentionReview(row.review);
}
