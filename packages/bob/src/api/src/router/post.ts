import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure, publicProcedure } from "../trpc";
import { postAll, postById, postCreate, postDelete } from "../handlers/post";

// The `Post` demo table (and its `CreatePostSchema`) was removed from
// `@bob/db/schema`; this router is dead code (imported nowhere) but kept
// compiling with an inline schema.
const CreatePostSchema = z.object({
  title: z.string(),
  content: z.string(),
});

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
