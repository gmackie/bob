import type { TRPCRouterRecord } from "@trpc/server";
import { desc, eq } from "@bob/db";
import { db } from "@bob/db/client";
import {
  chatConversations,
  sessionCheckpoints,
} from "@bob/db/schema";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";

export const checkpointRouter = {
  create: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        turnNumber: z.number().int().min(0),
        eventSeq: z.number().int().min(0),
        label: z.string().optional(),
        snapshotData: z.record(z.string(), z.unknown()).default({}),
        gitRef: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
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
    }),

  list: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(sessionCheckpoints)
        .where(eq(sessionCheckpoints.sessionId, input.sessionId))
        .orderBy(desc(sessionCheckpoints.turnNumber));
      return rows;
    }),

  branchFrom: protectedProcedure
    .input(z.object({ checkpointId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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
          userId: ctx.session.user.id,
          repositoryId: originalSession.repositoryId,
          worktreeId: originalSession.worktreeId,
          workingDirectory: originalSession.workingDirectory,
          title: branchTitle.slice(0, 256),
          sessionType: originalSession.sessionType,
          workItemId: originalSession.workItemId,
        })
        .returning();

      // Create an initial checkpoint in the new session referencing the branch point
      await db.insert(sessionCheckpoints).values({
        sessionId: newSession!.id,
        turnNumber: 0,
        eventSeq: 0,
        label: `Branched from checkpoint ${checkpoint.id}`,
        snapshotData: checkpoint.snapshotData,
        gitRef: checkpoint.gitRef,
      });

      return newSession;
    }),
} satisfies TRPCRouterRecord;
