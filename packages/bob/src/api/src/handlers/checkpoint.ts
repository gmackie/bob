/**
 * Checkpoint handler functions — pure business logic extracted from the tRPC
 * checkpoint router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import { chatConversations, sessionCheckpoints } from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function checkpointCreate(
  _ctx: HandlerContext,
  input: {
    sessionId: string;
    turnNumber: number;
    eventSeq: number;
    label?: string;
    snapshotData: Record<string, unknown>;
    gitRef?: string;
  },
) {
  const [checkpoint] = await db
    .insert(sessionCheckpoints)
    .values({
      sessionId: input.sessionId,
      turnNumber: input.turnNumber,
      eventSeq: input.eventSeq,
      label: input.label ?? null,
      snapshotData: input.snapshotData,
      gitRef: input.gitRef ?? null,
    })
    .returning();
  return checkpoint;
}

export async function checkpointList(
  _ctx: HandlerContext,
  input: { sessionId: string },
) {
  const rows = await db
    .select()
    .from(sessionCheckpoints)
    .where(eq(sessionCheckpoints.sessionId, input.sessionId))
    .orderBy(desc(sessionCheckpoints.turnNumber));
  return rows;
}

export async function checkpointBranchFrom(
  ctx: HandlerContext,
  input: { checkpointId: string },
) {
  // Fetch the checkpoint
  const checkpoints = await db
    .select()
    .from(sessionCheckpoints)
    .where(eq(sessionCheckpoints.id, input.checkpointId))
    .limit(1);

  const checkpoint = checkpoints[0];
  if (!checkpoint) {
    throw new Error("Checkpoint not found");
  }

  // Fetch the original session
  const sessions = await db
    .select()
    .from(chatConversations)
    .where(eq(chatConversations.id, checkpoint.sessionId))
    .limit(1);

  const originalSession = sessions[0];
  if (!originalSession) {
    throw new Error("Original session not found");
  }

  // Create a new branched session
  const branchTitle = `Branch from ${originalSession.title ?? "session"} @ turn ${checkpoint.turnNumber}`;
  const [newSession] = await db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      repositoryId: originalSession.repositoryId,
      worktreeId: originalSession.worktreeId,
      workingDirectory: originalSession.workingDirectory,
      title: branchTitle.slice(0, 256),
      sessionType: originalSession.sessionType,
      workItemId: originalSession.workItemId,
    })
    .returning();

  if (!newSession) {
    throw new Error("Failed to create branched session: insert returned no row");
  }

  // Create an initial checkpoint in the new session referencing the branch point
  await db.insert(sessionCheckpoints).values({
    sessionId: newSession.id,
    turnNumber: 0,
    eventSeq: 0,
    label: `Branched from checkpoint ${checkpoint.id}`,
    snapshotData: checkpoint.snapshotData,
    gitRef: checkpoint.gitRef,
  });

  return newSession;
}
