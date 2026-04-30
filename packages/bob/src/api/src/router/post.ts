import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { CreatePostSchema } from "@bob/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";
import { postAll, postById, postCreate, postDelete } from "../handlers/post";

export const postRouter: TRPCRouterRecord = {
  all: publicProcedure.query(({ ctx }) =>
    postAll({ db: ctx.db, session: ctx.session }),
  ),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      postById({ db: ctx.db, session: ctx.session }, input),
    ),

  create: protectedProcedure
    .input(CreatePostSchema)
    .mutation(({ ctx, input }) =>
      postCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure.input(z.string()).mutation(({ ctx, input }) =>
    postDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
  ),
};
