import type {
  ConversationDetailV1,
  ConversationEventListInputV1,
  ConversationEventListPageV1,
  ConversationEventV1,
} from "../contracts/v1";
import { and, eq } from "drizzle-orm";
import type { db as database } from "../db/client";
import { mapLegacySessionEvent } from "../db/migrations/personal-os-v1";
import {
  researchThread,
  runnerSession,
  sessionEvent,
} from "../db/schema/research";
import { getConversation } from "./conversations";
import { listConversationEvents } from "./events";
import { OodaKernelProblem, notFound } from "./problems";
import { decodeCursor, encodeCursor } from "./serialization";

type OodaDatabase = typeof database;

type LegacyThread = {
  id: string;
  ownerId: string | null;
  title: string;
  status: "active" | "paused" | "archived" | "completed";
  createdAt: Date;
  updatedAt: Date | null;
};

type LegacyEvent = {
  id: string;
  sessionId: string;
  adapterId: string;
  type: string;
  content: string;
  createdAt: Date;
};

export function translateLegacyResearchConversation(input: {
  thread: LegacyThread;
  events: LegacyEvent[];
}): { detail: ConversationDetailV1; events: ConversationEventV1[] } {
  const ordered = [...input.events].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
  const ownerId = input.thread.ownerId ?? "legacy-unowned";
  const updatedAt = input.thread.updatedAt ?? input.thread.createdAt;
  const branch = {
    id: input.thread.id,
    conversationId: input.thread.id,
    name: "main",
    reason: "Legacy compatibility root branch",
    createdAt: input.thread.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
  const events: ConversationEventV1[] = [
    {
      id: input.thread.id,
      conversationId: input.thread.id,
      branchId: input.thread.id,
      sequence: "1",
      type: "system_annotation",
      actor: { type: "system" },
      payload: {
        annotation: "Legacy research thread compatibility view",
        migration: { source: "research_thread", sourceId: input.thread.id },
      },
      sensitivity: "general",
      correlationId: `legacy-research-thread:${input.thread.id}`,
      idempotencyKey: `legacy-research-thread:${input.thread.id}`,
      occurredAt: input.thread.createdAt.toISOString(),
    },
    ...ordered.map((legacy, index): ConversationEventV1 => {
      const mapping = mapLegacySessionEvent(legacy.type);
      const actorId =
        mapping.actorType === "user"
          ? ownerId
          : mapping.actorType === "host"
            ? legacy.adapterId
            : undefined;
      return {
        id: legacy.id,
        conversationId: input.thread.id,
        branchId: input.thread.id,
        sequence: String(index + 2),
        type: mapping.type,
        actor: { type: mapping.actorType, ...(actorId ? { id: actorId } : {}) },
        payload: {
          content: legacy.content,
          migration: {
            source: "session_event",
            sourceId: legacy.id,
            legacyType: legacy.type,
            legacySessionId: legacy.sessionId,
            provider: legacy.adapterId,
          },
        },
        sensitivity: mapping.sensitivity,
        correlationId: `legacy-runner-session:${legacy.sessionId}`,
        causationId: legacy.sessionId,
        idempotencyKey: `legacy-session-event:${legacy.id}`,
        occurredAt: legacy.createdAt.toISOString(),
      };
    }),
  ];

  return {
    detail: {
      conversation: {
        id: input.thread.id,
        ownerId,
        title: input.thread.title,
        status: input.thread.status === "archived" ? "archived" : "active",
        hostProvider: "grok",
        hostProfile: "legacy-research",
        activeBranchId: input.thread.id,
        lastSequence: String(events.length),
        sensitivityCeiling: "personal",
        ttsPolicy: "manual",
        createdAt: input.thread.createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
      branches: [branch],
    },
    events,
  };
}

async function loadLegacyResearchConversation(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
) {
  const [thread] = await db
    .select()
    .from(researchThread)
    .where(
      and(eq(researchThread.id, conversationId), eq(researchThread.ownerId, ownerId)),
    )
    .limit(1);
  if (!thread) throw notFound("Conversation");

  const rows = await db
    .select({
      id: sessionEvent.id,
      sessionId: sessionEvent.sessionId,
      adapterId: runnerSession.adapterId,
      type: sessionEvent.type,
      content: sessionEvent.content,
      createdAt: sessionEvent.createdAt,
    })
    .from(sessionEvent)
    .innerJoin(runnerSession, eq(runnerSession.id, sessionEvent.sessionId))
    .where(eq(runnerSession.threadId, conversationId));
  return translateLegacyResearchConversation({
    thread: {
      id: thread.id,
      ownerId: thread.ownerId,
      title: thread.title,
      status: thread.status,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    events: rows,
  });
}

function isNotFound(error: unknown): boolean {
  return error instanceof OodaKernelProblem && error.code === "NOT_FOUND";
}

export async function getConversationCompatible(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
): Promise<ConversationDetailV1> {
  try {
    return await getConversation(db, ownerId, conversationId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return (await loadLegacyResearchConversation(db, ownerId, conversationId)).detail;
  }
}

export async function listConversationEventsCompatible(
  db: OodaDatabase,
  ownerId: string,
  input: ConversationEventListInputV1,
): Promise<ConversationEventListPageV1> {
  try {
    return await listConversationEvents(db, ownerId, input);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const translated = await loadLegacyResearchConversation(
    db,
    ownerId,
    input.conversationId,
  );
  const limit = input.limit ?? 100;
  let afterSequence = 0n;
  if (input.cursor) {
    const cursor = decodeCursor<{ sequence: string }>(input.cursor);
    if (!/^\d+$/.test(cursor.sequence ?? "")) {
      throw new OodaKernelProblem("BAD_CURSOR", 400, "The event cursor is invalid");
    }
    afterSequence = BigInt(cursor.sequence);
  }
  const matching = translated.events.filter(
    (event) =>
      BigInt(event.sequence) > afterSequence &&
      (!input.branchId || event.branchId === input.branchId),
  );
  const hasMore = matching.length > limit;
  const items = matching.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      hasMore,
      ...(hasMore && last
        ? { nextCursor: encodeCursor({ sequence: last.sequence }) }
        : {}),
    },
  };
}
