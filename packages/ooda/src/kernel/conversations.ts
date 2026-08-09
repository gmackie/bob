import { and, desc, eq, ilike, lt, or } from "drizzle-orm";

import type {
  ArchiveConversationInputV1,
  ArchiveConversationResultV1,
  ConversationDetailV1,
  ConversationListInputV1,
  ConversationListPageV1,
  CreateConversationInputV1,
  CreateConversationResultV1,
  ForkConversationInputV1,
  ForkConversationResultV1,
} from "../contracts/v1";
import type { db as database } from "../db/client";
import {
  conversationBranches,
  conversationEvents,
  conversations,
} from "../db/schema/conversations";
import { mapBranch, mapConversation } from "./mappers";
import {
  OodaKernelProblem,
  idempotencyConflict,
  notFound,
} from "./problems";
import { decodeCursor, encodeCursor, stableStringify } from "./serialization";

type OodaDatabase = typeof database;

async function ownedConversation(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.ownerId, ownerId)))
    .limit(1);
  if (!row) throw notFound("Conversation");
  return row;
}

async function findCreationReplay(
  db: OodaDatabase,
  ownerId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CreateConversationResultV1 | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerId, ownerId),
        eq(conversations.creationIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!conversation) return null;
  if (conversation.creationFingerprint !== fingerprint) throw idempotencyConflict();

  const [branch] = await db
    .select()
    .from(conversationBranches)
    .where(
      and(
        eq(conversationBranches.conversationId, conversation.id),
        eq(conversationBranches.idempotencyKey, `${idempotencyKey}:root`),
      ),
    )
    .limit(1);
  if (!branch) {
    throw new OodaKernelProblem(
      "CONFLICT",
      409,
      "The conversation creation receipt is incomplete",
    );
  }
  return {
    conversation: mapConversation(conversation),
    branch: mapBranch(branch),
    replayed: true,
  };
}

export async function createConversation(
  db: OodaDatabase,
  ownerId: string,
  input: CreateConversationInputV1,
): Promise<CreateConversationResultV1> {
  const fingerprint = stableStringify(input);
  const replay = await findCreationReplay(
    db,
    ownerId,
    input.idempotencyKey,
    fingerprint,
  );
  if (replay) return replay;

  const conversationId = crypto.randomUUID();
  const branchId = crypto.randomUUID();

  const inserted = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({
        id: conversationId,
        ownerId,
        title: input.title,
        hostProvider: input.hostProvider,
        hostProfile: input.hostProfile,
        sensitivityCeiling: input.sensitivityCeiling,
        ttsPolicy: input.ttsPolicy,
        creationIdempotencyKey: input.idempotencyKey,
        creationFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!conversation) return null;

    const [branch] = await tx
      .insert(conversationBranches)
      .values({
        id: branchId,
        conversationId,
        name: "main",
        reason: "Root branch",
        idempotencyKey: `${input.idempotencyKey}:root`,
        commandFingerprint: fingerprint,
      })
      .returning();
    const [activated] = await tx
      .update(conversations)
      .set({ activeBranchId: branchId })
      .where(eq(conversations.id, conversationId))
      .returning();
    if (!branch || !activated) throw new Error("Failed to initialize conversation");
    return {
      conversation: mapConversation(activated),
      branch: mapBranch(branch),
      replayed: false,
    };
  });

  if (inserted) return inserted;
  const concurrentReplay = await findCreationReplay(
    db,
    ownerId,
    input.idempotencyKey,
    fingerprint,
  );
  if (!concurrentReplay) {
    throw new OodaKernelProblem("CONFLICT", 409, "Conversation creation conflicted");
  }
  return concurrentReplay;
}

export async function listConversations(
  db: OodaDatabase,
  ownerId: string,
  input: ConversationListInputV1,
): Promise<ConversationListPageV1> {
  const limit = input.limit ?? 50;
  const conditions = [eq(conversations.ownerId, ownerId)];
  if (input.status) conditions.push(eq(conversations.status, input.status));
  if (input.query) conditions.push(ilike(conversations.title, `%${input.query}%`));
  if (input.cursor) {
    const cursor = decodeCursor<{ updatedAt: string; id: string }>(input.cursor);
    const updatedAt = new Date(cursor.updatedAt);
    if (!cursor.id || Number.isNaN(updatedAt.getTime())) {
      throw new OodaKernelProblem("BAD_CURSOR", 400, "The conversation cursor is invalid");
    }
    conditions.push(
      or(
        lt(conversations.updatedAt, updatedAt),
        and(eq(conversations.updatedAt, updatedAt), lt(conversations.id, cursor.id)),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(mapConversation),
    pageInfo: {
      hasMore,
      ...(hasMore && last
        ? {
            nextCursor: encodeCursor({
              updatedAt: last.updatedAt.toISOString(),
              id: last.id,
            }),
          }
        : {}),
    },
  };
}

export async function getConversation(
  db: OodaDatabase,
  ownerId: string,
  conversationId: string,
): Promise<ConversationDetailV1> {
  const conversation = await ownedConversation(db, ownerId, conversationId);
  const branches = await db
    .select()
    .from(conversationBranches)
    .where(eq(conversationBranches.conversationId, conversationId))
    .orderBy(conversationBranches.createdAt, conversationBranches.id);
  return {
    conversation: mapConversation(conversation),
    branches: branches.map(mapBranch),
  };
}

async function findForkReplay(
  db: OodaDatabase,
  conversationId: string,
  input: ForkConversationInputV1,
  fingerprint: string,
): Promise<ForkConversationResultV1 | null> {
  const [branch] = await db
    .select()
    .from(conversationBranches)
    .where(
      and(
        eq(conversationBranches.conversationId, conversationId),
        eq(conversationBranches.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (!branch) return null;
  if (branch.commandFingerprint !== fingerprint) throw idempotencyConflict();
  return { branch: mapBranch(branch), replayed: true };
}

export async function forkConversation(
  db: OodaDatabase,
  ownerId: string,
  input: ForkConversationInputV1,
): Promise<ForkConversationResultV1> {
  await ownedConversation(db, ownerId, input.conversationId);
  const fingerprint = stableStringify(input);
  const replay = await findForkReplay(db, input.conversationId, input, fingerprint);
  if (replay) return replay;

  const [parent] = await db
    .select({ id: conversationBranches.id })
    .from(conversationBranches)
    .where(
      and(
        eq(conversationBranches.id, input.parentBranchId),
        eq(conversationBranches.conversationId, input.conversationId),
      ),
    )
    .limit(1);
  if (!parent) throw notFound("Parent branch");

  const [forkEvent] = await db
    .select({ id: conversationEvents.id })
    .from(conversationEvents)
    .where(
      and(
        eq(conversationEvents.id, input.forkEventId),
        eq(conversationEvents.conversationId, input.conversationId),
        eq(conversationEvents.branchId, input.parentBranchId),
      ),
    )
    .limit(1);
  if (!forkEvent) throw notFound("Fork event");

  const branchId = crypto.randomUUID();
  const inserted = await db.transaction(async (tx) => {
    const [branch] = await tx
      .insert(conversationBranches)
      .values({
        id: branchId,
        conversationId: input.conversationId,
        parentBranchId: input.parentBranchId,
        forkEventId: input.forkEventId,
        name: input.name,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        commandFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!branch) return null;
    await tx
      .update(conversations)
      .set({ activeBranchId: branchId })
      .where(eq(conversations.id, input.conversationId));
    return { branch: mapBranch(branch), replayed: false };
  });
  if (inserted) return inserted;

  const concurrentReplay = await findForkReplay(
    db,
    input.conversationId,
    input,
    fingerprint,
  );
  if (concurrentReplay) return concurrentReplay;
  throw new OodaKernelProblem("CONFLICT", 409, "A branch with that name already exists");
}

export async function archiveConversation(
  db: OodaDatabase,
  ownerId: string,
  input: ArchiveConversationInputV1,
): Promise<ArchiveConversationResultV1> {
  const current = await ownedConversation(db, ownerId, input.conversationId);
  if (current.status === "archived") {
    return { conversation: mapConversation(current), replayed: true };
  }
  const [archived] = await db
    .update(conversations)
    .set({ status: "archived" })
    .where(
      and(eq(conversations.id, input.conversationId), eq(conversations.ownerId, ownerId)),
    )
    .returning();
  if (!archived) throw notFound("Conversation");
  return { conversation: mapConversation(archived), replayed: false };
}
