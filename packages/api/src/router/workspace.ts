import { z } from "zod/v4";

import { desc, eq } from "@bob/db";
import {
  workspaceMembers,
  workspaces,
  workspaceMemberRole,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const workspaceRouter = {
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, ctx.session.user.id),
      with: {
        workspace: true,
      },
      orderBy: desc(workspaceMembers.joinedAt),
    }),
  ),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        slug: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9-]+$/),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({
          ownerUserId: ctx.session.user.id,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
        })
        .returning();

      await ctx.db
        .insert(workspaceMembers)
        .values({
          workspaceId: workspace!.id,
          userId: ctx.session.user.id,
          role: "owner" satisfies (typeof workspaceMemberRole)[number],
        })
        .returning();

      return workspace;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const membership = await ctx.db.query.workspaceMembers.findFirst({
        where: eq(workspaceMembers.workspaceId, input.id),
        with: { workspace: true },
      });

      if (
        !membership ||
        membership.userId !== ctx.session.user.id ||
        membership.role !== "owner"
      ) {
        throw new Error("Not authorized to delete this workspace");
      }

      await ctx.db
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, input.id));
      await ctx.db.delete(workspaces).where(eq(workspaces.id, input.id));

      return { deleted: true };
    }),
};
