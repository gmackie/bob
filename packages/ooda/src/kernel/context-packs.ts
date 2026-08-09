import { and, asc, eq } from "drizzle-orm";

import type { ContextPackV1 } from "../contracts/v1";
import type { db as database } from "../db/client";
import { conversations } from "../db/schema/conversations";
import { contextItems, contextPacks } from "../db/schema/orchestration";
import {
  applyHostContextPolicy,
  collectContextCandidates,
  formatDisclosedContext,
  type ConversationContextSource,
} from "./context-sources";
import { notFound } from "./problems";

type OodaDatabase = typeof database;

function iso(value: Date): string {
  return value.toISOString();
}

async function buildDisclosedContextPack(
  db: OodaDatabase,
  ownerId: string,
  input: {
    conversationId: string;
    provider: string;
    query: string;
    sources: ConversationContextSource[];
    now: Date;
    signal?: AbortSignal;
    purpose: "host_turn" | "agent_job";
  },
): Promise<{ pack: ContextPackV1; promptContext: string }> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!conversation) throw notFound("Conversation");

  const collected = await collectContextCandidates(input.sources, {
    query: input.query,
    limitPerSource: 8,
    signal: input.signal,
  });
  const decisions = applyHostContextPolicy(collected.candidates).slice(0, 24);
  const configuredSourceIds = new Set(input.sources.map((source) => source.id));
  const unconfiguredReceipts = ["bob-kanbanger", "bizpulse", "forgegraph"]
    .filter((source) => !configuredSourceIds.has(source))
    .map((source) => ({
      source,
      status: "unavailable" as const,
      itemCount: 0,
      reason: "Source not configured",
    }));
  const policySnapshot = {
    version:
      input.purpose === "host_turn"
        ? "host-context-v1"
        : "agent-job-context-v1",
    allowedSensitivities: ["general", "personal"],
    automaticSensitiveDisclosure: false,
    rawDiffsIncluded: false,
    sourceReceipts: [...collected.receipts, ...unconfiguredReceipts],
  };

  const stored = await db.transaction(async (tx) => {
    const [pack] = await tx
      .insert(contextPacks)
      .values({
        conversationId: input.conversationId,
        provider: input.provider,
        purpose: input.purpose,
        policySnapshot,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1_000),
      })
      .returning();
    if (!pack) throw new Error("Context pack insert returned no row");

    const inserted = decisions.length
      ? await tx
          .insert(contextItems)
          .values(
            decisions.map((item, ordinal) => ({
              contextPackId: pack.id,
              sourceType: item.sourceType,
              sourceId: item.sourceId,
              sensitivity: item.sensitivity,
              decision: item.decision,
              reason: item.reason,
              content: item.content,
              redaction: item.redaction,
              ordinal,
            })),
          )
          .returning()
      : [];
    return { pack, inserted };
  });

  return {
    pack: {
      id: stored.pack.id,
      conversationId: stored.pack.conversationId,
      provider: stored.pack.provider,
      purpose: input.purpose,
      policySnapshot: stored.pack.policySnapshot,
      items: stored.inserted.map((item) => ({
        id: item.id,
        sourceType:
          item.sourceType as ContextPackV1["items"][number]["sourceType"],
        sourceId: item.sourceId,
        sensitivity: item.sensitivity,
        decision: item.decision as ContextPackV1["items"][number]["decision"],
        reason: item.reason,
        ...(item.content === null ? {} : { content: item.content }),
        ...(item.redaction === null ? {} : { redaction: item.redaction }),
      })),
      createdAt: iso(stored.pack.createdAt),
      ...(stored.pack.expiresAt
        ? { expiresAt: iso(stored.pack.expiresAt) }
        : {}),
    },
    promptContext: formatDisclosedContext(decisions),
  };
}

export function buildHostContextPack(
  db: OodaDatabase,
  ownerId: string,
  input: Omit<Parameters<typeof buildDisclosedContextPack>[2], "purpose">,
) {
  return buildDisclosedContextPack(db, ownerId, {
    ...input,
    purpose: "host_turn",
  });
}

export function buildAgentJobContextPack(
  db: OodaDatabase,
  ownerId: string,
  input: Omit<Parameters<typeof buildDisclosedContextPack>[2], "purpose">,
) {
  return buildDisclosedContextPack(db, ownerId, {
    ...input,
    purpose: "agent_job",
  });
}

export async function getContextPack(
  db: OodaDatabase,
  ownerId: string,
  id: string,
): Promise<ContextPackV1> {
  const [pack] = await db
    .select({ pack: contextPacks })
    .from(contextPacks)
    .innerJoin(
      conversations,
      and(
        eq(conversations.id, contextPacks.conversationId),
        eq(conversations.ownerId, ownerId),
      ),
    )
    .where(eq(contextPacks.id, id))
    .limit(1);
  if (!pack) throw notFound("Context pack");
  const items = await db
    .select()
    .from(contextItems)
    .where(eq(contextItems.contextPackId, id))
    .orderBy(asc(contextItems.ordinal));

  return {
    id: pack.pack.id,
    conversationId: pack.pack.conversationId,
    provider: pack.pack.provider,
    purpose: pack.pack.purpose as ContextPackV1["purpose"],
    policySnapshot: pack.pack.policySnapshot,
    items: items.map((item) => ({
      id: item.id,
      sourceType:
        item.sourceType as ContextPackV1["items"][number]["sourceType"],
      sourceId: item.sourceId,
      sensitivity: item.sensitivity,
      decision: item.decision as ContextPackV1["items"][number]["decision"],
      reason: item.reason,
      ...(item.content === null ? {} : { content: item.content }),
      ...(item.redaction === null ? {} : { redaction: item.redaction }),
    })),
    createdAt: iso(pack.pack.createdAt),
    ...(pack.pack.expiresAt ? { expiresAt: iso(pack.pack.expiresAt) } : {}),
  };
}
