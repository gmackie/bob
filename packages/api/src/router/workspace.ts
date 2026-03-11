import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq } from "@bob/db";
import {
  workspaceMembers,
  workspaces,
  workspaceMemberRole,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const workspaceRouter: TRPCRouterRecord = {
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
};
