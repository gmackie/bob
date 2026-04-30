import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  workspaceList,
  workspaceCreate,
  workspaceRename,
  workspaceDelete,
} from "../handlers/workspace";

export const workspaceRouter = {
  list: protectedProcedure.query(({ ctx }) =>
    workspaceList({ db: ctx.db, userId: ctx.session.user.id }),
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
    .mutation(({ ctx, input }) =>
      workspaceCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  rename: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(128),
      }),
    )
    .mutation(({ ctx, input }) =>
      workspaceRename({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      workspaceDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
};
