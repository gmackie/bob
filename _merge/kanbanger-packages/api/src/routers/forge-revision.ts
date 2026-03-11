import { forgeRevisions } from "@linear-clone/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const forgeRevisionListInputSchema = z.object({
  repoId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const forgeRevisionGetInputSchema = z.object({
  repoId: z.string().uuid(),
  revId: z.string().min(1),
});

export const forgeRevisionRequestIndexInputSchema = z.object({
  repoId: z.string().uuid(),
  revId: z.string().min(1),
  changeId: z.string().optional(),
  description: z.string().optional(),
  parentRevIds: z.array(z.string()).optional(),
  bookmarks: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const forgeRevisionRouter = router({
  list: protectedProcedure
    .input(forgeRevisionListInputSchema)
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(forgeRevisions)
        .where(eq(forgeRevisions.repoId, input.repoId))
        .orderBy(desc(forgeRevisions.indexedAt))
        .limit(input.limit);
    }),

  get: protectedProcedure
    .input(forgeRevisionGetInputSchema)
    .query(async ({ ctx, input }) => {
      const [revision] = await ctx.db
        .select()
        .from(forgeRevisions)
        .where(
          and(
            eq(forgeRevisions.repoId, input.repoId),
            eq(forgeRevisions.revId, input.revId)
          )
        )
        .limit(1);

      return revision ?? null;
    }),

  requestIndex: protectedProcedure
    .input(forgeRevisionRequestIndexInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select()
        .from(forgeRevisions)
        .where(
          and(
            eq(forgeRevisions.repoId, input.repoId),
            eq(forgeRevisions.revId, input.revId)
          )
        )
        .limit(1);

      if (existing) {
        const [updated] = await ctx.db
          .update(forgeRevisions)
          .set({
            changeId: input.changeId ?? existing.changeId,
            description: input.description ?? existing.description,
            parentRevIds: input.parentRevIds ?? existing.parentRevIds,
            bookmarks: input.bookmarks ?? existing.bookmarks,
            metadata: input.metadata ?? existing.metadata,
            indexedAt: new Date(),
          })
          .where(eq(forgeRevisions.id, existing.id))
          .returning();

        return updated;
      }

      const [created] = await ctx.db
        .insert(forgeRevisions)
        .values({
          repoId: input.repoId,
          revId: input.revId,
          changeId: input.changeId,
          description: input.description,
          parentRevIds: input.parentRevIds ?? [],
          bookmarks: input.bookmarks ?? [],
          metadata: input.metadata,
        })
        .returning();

      return created;
    }),
});
