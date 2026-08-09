import { and, asc, eq, gt, sql } from "drizzle-orm";

import type {
  AppendConversationEventInputV1,
  AppendConversationEventResultV1,
  ConversationEventListInputV1,
  ConversationEventListPageV1,
  CorrectConversationEventInputV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import {
  conversationBranches,
  conversationEvents,
  conversations,
} from "../db/schema/conversations";
import { memoryEdges, memorySeeds } from "../db/schema/memory";
import { mapEvent } from "./mappers";
import { deriveMemoryCapture } from "./memory-capture";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import {
  decodeCursor,
  encodeCursor,
  isUniqueViolation,
  stableStringify,
} from "./serialization";

type OodaDatabase = typeof database;

async function assertOwnedConversation(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
) {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, ownerId)))
    .limit(1);
  if (!conversation) throw notFound("Conversation");
}

function eventInputFingerprint(input: AppendConversationEventInputV1): string {
  return stableStringify(input);
}

function storedEventFingerprint(row: typeof conversationEvents.$inferSelect): string {
  const event = mapEvent(row);
  const { id: _id, sequence: _sequence, ...input } = event;
  return stableStringify(input);
}

async function findEventReplay(
  db: OodaDatabase,
  ownerId: string,
  input: AppendConversationEventInputV1,
): Promise<AppendConversationEventResultV1 | null> {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  const [existing] = await db
    .select()
    .from(conversationEvents)
    .where(
      and(
        eq(conversationEvents.conversationId, input.conversationId),
        eq(conversationEvents.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) return null;
  if (storedEventFingerprint(existing) !== eventInputFingerprint(input)) {
    throw idempotencyConflict();
  }
  return { event: mapEvent(existing), replayed: true };
}

export async function appendConversationEvent(
  db: OodaDatabase,
  ownerId: string,
  input: AppendConversationEventInputV1,
): Promise<AppendConversationEventResultV1> {
  const replay = await findEventReplay(db, ownerId, input);
  if (replay) return replay;

  try {
    return await db.transaction(async (tx) => {
      const [branch] = await tx
        .select({ id: conversationBranches.id })
        .from(conversationBranches)
        .where(
          and(
            eq(conversationBranches.id, input.branchId),
            eq(conversationBranches.conversationId, input.conversationId),
          ),
        )
        .limit(1);
      if (!branch) throw notFound("Conversation branch");

      const [allocated] = await tx
        .update(conversations)
        .set({
          lastSequence: sql`${conversations.lastSequence} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.ownerId, ownerId),
          ),
        )
        .returning({ sequence: conversations.lastSequence });
      if (!allocated) throw notFound("Conversation");

      const [event] = await tx
        .insert(conversationEvents)
        .values({
          conversationId: input.conversationId,
          branchId: input.branchId,
          sequence: BigInt(allocated.sequence),
          type: input.type,
          actorType: input.actor.type,
          actorId: input.actor.id,
          payload: input.payload,
          sensitivity: input.sensitivity,
          correlationId: input.correlationId,
          causationId: input.causationId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: new Date(input.occurredAt),
        })
        .returning();
      if (!event) throw new Error("Event insert returned no row");

      const capture = deriveMemoryCapture({
        type: input.type,
        payload: input.payload,
      });
      if (capture) {
        const [seed] = await tx
          .insert(memorySeeds)
          .values({
            conversationId: input.conversationId,
            kind: capture.kind,
            sourceEventId: event.id,
            sourceSpanStart: capture.sourceSpan.start,
            sourceSpanEnd: capture.sourceSpan.end,
            normalizedText: capture.normalizedText,
            entities: capture.entities,
            sensitivity: input.sensitivity,
            confidence: capture.confidence,
            lifecycleState: "captured",
            createdAt: new Date(input.occurredAt),
            updatedAt: new Date(input.occurredAt),
          })
          .returning();

        const correctedEventId = input.type === "correction"
          && typeof input.payload.correctedEventId === "string"
          ? input.payload.correctedEventId
          : null;
        if (seed && correctedEventId) {
          const superseded = await tx
            .update(memorySeeds)
            .set({
              supersededById: seed.id,
              updatedAt: new Date(input.occurredAt),
            })
            .where(eq(memorySeeds.sourceEventId, correctedEventId))
            .returning({ id: memorySeeds.id });
          if (superseded.length) {
            await tx.insert(memoryEdges).values(
              superseded.map((prior) => ({
                fromMemoryId: seed.id,
                toMemoryId: prior.id,
                kind: "supersedes" as const,
                score: 1,
                explanation: "A user correction supersedes the earlier captured wording.",
                discoveryMethod: "conversation_correction",
                feedbackState: "confirmed" as const,
                createdAt: new Date(input.occurredAt),
                updatedAt: new Date(input.occurredAt),
              })),
            );
          }
        }
      }
      return { event: mapEvent(event), replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const concurrentReplay = await findEventReplay(db, ownerId, input);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}

export async function listConversationEvents(
  db: OodaDatabase,
  ownerId: string,
  input: ConversationEventListInputV1,
): Promise<ConversationEventListPageV1> {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  const limit = input.limit ?? 100;
  const conditions = [eq(conversationEvents.conversationId, input.conversationId)];
  if (input.branchId) conditions.push(eq(conversationEvents.branchId, input.branchId));
  if (input.cursor) {
    const cursor = decodeCursor<{ sequence: string }>(input.cursor);
    if (!/^\d+$/.test(cursor.sequence ?? "")) {
      throw new OodaKernelProblem(
        "BAD_CURSOR",
        400,
        "The event cursor is invalid",
      );
    }
    conditions.push(gt(conversationEvents.sequence, BigInt(cursor.sequence)));
  }

  const rows = await db
    .select()
    .from(conversationEvents)
    .where(and(...conditions))
    .orderBy(asc(conversationEvents.sequence))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapEvent),
    pageInfo: {
      hasMore,
      ...(hasMore && last
        ? { nextCursor: encodeCursor({ sequence: String(last.sequence) }) }
        : {}),
    },
  };
}

export async function listConversationEventsAfterSequence(
  db: OodaDatabase,
  ownerId: string,
  input: {
    conversationId: string;
    afterSequence: string;
    limit?: number;
  },
) {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  if (!/^\d+$/.test(input.afterSequence)) {
    throw new OodaKernelProblem(
      "VALIDATION_FAILED",
      422,
      "afterSequence must be a decimal sequence",
    );
  }
  const limit = Math.min(Math.max(input.limit ?? 250, 1), 1_000);
  const rows = await db
    .select()
    .from(conversationEvents)
    .where(
      and(
        eq(conversationEvents.conversationId, input.conversationId),
        gt(conversationEvents.sequence, BigInt(input.afterSequence)),
      ),
    )
    .orderBy(asc(conversationEvents.sequence))
    .limit(limit);
  return rows.map(mapEvent);
}

export async function correctConversationEvent(
  db: OodaDatabase,
  ownerId: string,
  input: CorrectConversationEventInputV1,
): Promise<AppendConversationEventResultV1> {
  await assertOwnedConversation(db, ownerId, input.conversationId);
  const [corrected] = await db
    .select({ id: conversationEvents.id })
    .from(conversationEvents)
    .where(
      and(
        eq(conversationEvents.id, input.correctedEventId),
        eq(conversationEvents.conversationId, input.conversationId),
      ),
    )
    .limit(1);
  if (!corrected) throw notFound("Corrected event");

  return appendConversationEvent(db, ownerId, {
    conversationId: input.conversationId,
    branchId: input.branchId,
    type: "correction",
    actor: { type: "user", id: ownerId },
    payload: {
      correctedEventId: input.correctedEventId,
      replacementPayload: input.replacementPayload,
      reason: input.reason,
    },
    sensitivity: input.sensitivity,
    correlationId: input.correlationId,
    causationId: input.correctedEventId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
  });
}
