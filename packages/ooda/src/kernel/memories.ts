import { and, desc, eq, ilike, inArray, isNull, lt, or } from "drizzle-orm";

import type {
  MemoryDetailV1,
  MemoryEdgeV1,
  MemorySearchInputV1,
  MemorySearchPageV1,
  MemorySeedV1,
  SubmitMemoryFeedbackInputV1,
  SubmitMemoryFeedbackResultV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversations } from "../db/schema/conversations";
import { memoryEdges, memorySeeds } from "../db/schema/memory";
import { OodaKernelProblem, idempotencyConflict, notFound } from "./problems";
import { decodeCursor, encodeCursor, stableStringify } from "./serialization";

type OodaDatabase = typeof database;

function mapMemorySeed(row: typeof memorySeeds.$inferSelect): MemorySeedV1 {
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    sourceEventId: row.sourceEventId,
    sourceSpan: { start: row.sourceSpanStart, end: row.sourceSpanEnd },
    normalizedText: row.normalizedText,
    entities: row.entities,
    sensitivity: row.sensitivity,
    confidence: row.confidence,
    lifecycleState: row.lifecycleState,
    ...(row.supersededById ? { supersededById: row.supersededById } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMemoryEdge(row: typeof memoryEdges.$inferSelect): MemoryEdgeV1 {
  return {
    id: row.id,
    fromMemoryId: row.fromMemoryId,
    toMemoryId: row.toMemoryId,
    kind: row.kind,
    score: row.score,
    explanation: row.explanation,
    discoveryMethod: row.discoveryMethod,
    feedbackState: row.feedbackState,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ownedMemory(
  db: OodaDatabase,
  ownerId: string,
  memoryId: string,
) {
  const [row] = await db
    .select({ memory: memorySeeds })
    .from(memorySeeds)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, memorySeeds.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(memorySeeds.id, memoryId))
    .limit(1);
  if (!row) throw notFound("Memory");
  return row.memory;
}

export async function searchMemories(
  db: OodaDatabase,
  ownerId: string,
  input: MemorySearchInputV1,
): Promise<MemorySearchPageV1> {
  const limit = input.limit ?? 50;
  const conditions = [eq(conversations.ownerId, ownerId)];
  if (input.conversationId) {
    conditions.push(eq(memorySeeds.conversationId, input.conversationId));
  }
  if (input.lifecycleState) {
    conditions.push(eq(memorySeeds.lifecycleState, input.lifecycleState));
  }
  if (!input.includeSuperseded) conditions.push(isNull(memorySeeds.supersededById));
  if (input.query?.trim()) {
    conditions.push(ilike(memorySeeds.normalizedText, `%${input.query.trim()}%`));
  }
  if (input.cursor) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(input.cursor);
    const createdAt = new Date(cursor.createdAt);
    if (!cursor.id || Number.isNaN(createdAt.getTime())) {
      throw new OodaKernelProblem("BAD_CURSOR", 400, "The memory cursor is invalid");
    }
    conditions.push(
      or(
        lt(memorySeeds.createdAt, createdAt),
        and(eq(memorySeeds.createdAt, createdAt), lt(memorySeeds.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select({ memory: memorySeeds })
    .from(memorySeeds)
    .innerJoin(conversations, eq(conversations.id, memorySeeds.conversationId))
    .where(and(...conditions))
    .orderBy(desc(memorySeeds.createdAt), desc(memorySeeds.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit).map((row) => row.memory);
  const last = visible.at(-1);
  return {
    items: visible.map(mapMemorySeed),
    pageInfo: {
      hasMore,
      ...(hasMore && last
        ? {
            nextCursor: encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          }
        : {}),
    },
  };
}

export async function inspectMemory(
  db: OodaDatabase,
  ownerId: string,
  memoryId: string,
): Promise<MemoryDetailV1> {
  const memory = await ownedMemory(db, ownerId, memoryId);
  const edges = await db
    .select()
    .from(memoryEdges)
    .where(
      or(
        eq(memoryEdges.fromMemoryId, memoryId),
        eq(memoryEdges.toMemoryId, memoryId),
      ),
    );
  const otherIds = [...new Set(edges.map((edge) =>
    edge.fromMemoryId === memoryId ? edge.toMemoryId : edge.fromMemoryId,
  ))];
  const connected = otherIds.length
    ? await db.select().from(memorySeeds).where(inArray(memorySeeds.id, otherIds))
    : [];
  const byId = new Map(connected.map((seed) => [seed.id, seed]));
  return {
    memory: mapMemorySeed(memory),
    connections: edges.flatMap((edge) => {
      const otherId = edge.fromMemoryId === memoryId
        ? edge.toMemoryId
        : edge.fromMemoryId;
      const seed = byId.get(otherId);
      if (!seed) return [];
      return [{
        direction: edge.fromMemoryId === memoryId ? "outgoing" as const : "incoming" as const,
        edge: mapMemoryEdge(edge),
        memory: mapMemorySeed(seed),
      }];
    }),
  };
}

export async function submitMemoryFeedback(
  db: OodaDatabase,
  ownerId: string,
  input: SubmitMemoryFeedbackInputV1,
): Promise<SubmitMemoryFeedbackResultV1> {
  const [owned] = await db
    .select({ edge: memoryEdges })
    .from(memoryEdges)
    .innerJoin(memorySeeds, eq(memorySeeds.id, memoryEdges.fromMemoryId))
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, memorySeeds.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(memoryEdges.id, input.edgeId))
    .limit(1);
  if (!owned) throw notFound("Memory edge");
  const fingerprint = stableStringify(input);
  if (owned.edge.feedbackIdempotencyKey === input.idempotencyKey) {
    if (owned.edge.feedbackFingerprint !== fingerprint) throw idempotencyConflict();
    return { edge: mapMemoryEdge(owned.edge), replayed: true };
  }

  const [updated] = await db
    .update(memoryEdges)
    .set({
      feedbackState: input.feedbackState,
      feedbackIdempotencyKey: input.idempotencyKey,
      feedbackFingerprint: fingerprint,
      updatedAt: new Date(),
    })
    .where(eq(memoryEdges.id, input.edgeId))
    .returning();
  if (!updated) throw notFound("Memory edge");
  return { edge: mapMemoryEdge(updated), replayed: false };
}
