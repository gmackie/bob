import type {
  ConversationBranchV1,
  ConversationEventV1,
} from "../contracts/v1";
import { and, asc, eq } from "drizzle-orm";
import type { db as database } from "../db/client";
import {
  conversationBranches,
  conversationEvents,
  conversations,
} from "../db/schema/conversations";
import { mapBranch, mapEvent } from "./mappers";
import { OodaKernelProblem, notFound } from "./problems";

export type TimelineProjectionItem = {
  event: ConversationEventV1;
  effectivePayload: Record<string, unknown>;
  lineageDepth: number;
  correctedByEventId?: string;
};

type ProjectionInput = {
  branches: ConversationBranchV1[];
  events: ConversationEventV1[];
  targetBranchId: string;
};

type OodaDatabase = typeof database;

type CompactProjectionItem = {
  eventId: string;
  sequence: string;
  type: ConversationEventV1["type"];
  text?: string;
};

function sequenceOf(event: ConversationEventV1): bigint {
  return BigInt(event.sequence);
}

function orderedEvents(events: ConversationEventV1[]): ConversationEventV1[] {
  const ordered = [...events].sort((left, right) => {
    const sequenceOrder = sequenceOf(left) - sequenceOf(right);
    if (sequenceOrder < 0n) return -1;
    if (sequenceOrder > 0n) return 1;
    return left.id.localeCompare(right.id);
  });
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1]?.sequence === ordered[index]?.sequence) {
      throw new OodaKernelProblem(
        "CONFLICT",
        409,
        `Cannot project duplicate sequence ${ordered[index]?.sequence}`,
      );
    }
  }
  return ordered;
}

function branchLineage(
  branches: ConversationBranchV1[],
  targetBranchId: string,
): ConversationBranchV1[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const lineage: ConversationBranchV1[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(targetBranchId);
  if (!cursor) throw notFound("Target branch");

  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new OodaKernelProblem("CONFLICT", 409, "Conversation branch ancestry contains a cycle");
    }
    visited.add(cursor.id);
    lineage.push(cursor);
    cursor = cursor.parentBranchId ? byId.get(cursor.parentBranchId) : undefined;
    if (lineage.at(-1)?.parentBranchId && !cursor) throw notFound("Parent branch");
  }
  return lineage.reverse();
}

function correctionPayload(event: ConversationEventV1): {
  correctedEventId: string;
  replacementPayload: Record<string, unknown>;
} | null {
  if (event.type !== "correction") return null;
  const correctedEventId = event.payload.correctedEventId;
  const replacementPayload = event.payload.replacementPayload;
  if (
    typeof correctedEventId !== "string" ||
    !replacementPayload ||
    typeof replacementPayload !== "object" ||
    Array.isArray(replacementPayload)
  ) {
    return null;
  }
  return {
    correctedEventId,
    replacementPayload: replacementPayload as Record<string, unknown>,
  };
}

export function rebuildTimelineProjection(input: ProjectionInput): TimelineProjectionItem[] {
  const events = orderedEvents(input.events);
  const lineage = branchLineage(input.branches, input.targetBranchId);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const included: Array<{ event: ConversationEventV1; lineageDepth: number }> = [];

  for (let depth = 0; depth < lineage.length; depth += 1) {
    const branch = lineage[depth]!;
    const child = lineage[depth + 1];
    let cutoff: bigint | null = null;
    if (child) {
      const forkEvent = child.forkEventId ? eventById.get(child.forkEventId) : undefined;
      if (!forkEvent || forkEvent.branchId !== branch.id) throw notFound("Branch fork event");
      cutoff = sequenceOf(forkEvent);
    }
    for (const event of events) {
      if (event.branchId !== branch.id) continue;
      if (cutoff !== null && sequenceOf(event) > cutoff) continue;
      included.push({ event, lineageDepth: depth });
    }
  }
  included.sort((left, right) =>
    sequenceOf(left.event) < sequenceOf(right.event) ? -1 : 1,
  );

  const corrections = new Map<
    string,
    { replacementPayload: Record<string, unknown>; eventId: string; sequence: bigint }
  >();
  for (const { event } of included) {
    const correction = correctionPayload(event);
    if (!correction) continue;
    const existing = corrections.get(correction.correctedEventId);
    if (!existing || existing.sequence < sequenceOf(event)) {
      corrections.set(correction.correctedEventId, {
        replacementPayload: correction.replacementPayload,
        eventId: event.id,
        sequence: sequenceOf(event),
      });
    }
  }

  return included.map(({ event, lineageDepth }) => {
    const correction = corrections.get(event.id);
    return {
      event,
      effectivePayload: correction?.replacementPayload ?? event.payload,
      lineageDepth,
      ...(correction ? { correctedByEventId: correction.eventId } : {}),
    };
  });
}

function textFrom(payload: Record<string, unknown>): string | undefined {
  for (const key of ["display", "content", "text"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function compact(item: TimelineProjectionItem): CompactProjectionItem {
  const text = textFrom(item.effectivePayload);
  return {
    eventId: item.event.id,
    sequence: item.event.sequence,
    type: item.event.type,
    ...(text ? { text } : {}),
  };
}

export function rebuildConversationProjections(input: ProjectionInput) {
  const timeline = rebuildTimelineProjection(input);
  return {
    timeline: { items: timeline },
    search: {
      items: timeline
        .filter(({ event }) =>
          event.type === "user_turn" || event.type === "assistant_turn",
        )
        .map(compact)
        .filter((item): item is CompactProjectionItem & { text: string } => Boolean(item.text)),
    },
    inbox: {
      items: timeline.filter(({ event }) => event.type === "user_turn").map(compact),
    },
    dailyReview: {
      items: timeline
        .filter(({ event }) =>
          ["proposal", "failure", "external_evidence"].includes(event.type),
        )
        .map(compact),
    },
    activeWork: {
      items: timeline
        .filter(({ event }) =>
          ["agent_job_progress", "proposal", "delivery"].includes(event.type),
        )
        .map(compact),
    },
  };
}

export async function rebuildStoredConversationProjections(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
  targetBranchId?: string,
) {
  const [conversation] = await db
    .select({ activeBranchId: conversations.activeBranchId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, ownerId)))
    .limit(1);
  if (!conversation?.activeBranchId) throw notFound("Conversation");
  const [branches, events] = await Promise.all([
    db
      .select()
      .from(conversationBranches)
      .where(eq(conversationBranches.conversationId, conversationId))
      .orderBy(asc(conversationBranches.createdAt), asc(conversationBranches.id)),
    db
      .select()
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, conversationId))
      .orderBy(asc(conversationEvents.sequence)),
  ]);
  return rebuildConversationProjections({
    branches: branches.map(mapBranch),
    events: events.map(mapEvent),
    targetBranchId: targetBranchId ?? conversation.activeBranchId,
  });
}
