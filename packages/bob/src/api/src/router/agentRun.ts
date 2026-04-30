import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  agentRunGet,
  agentRunList,
  agentRunListByWorkItem,
} from "../handlers/agentRun";

export const agentRunRouter = {
  get: protectedProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      agentRunGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  list: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      agentRunList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      agentRunListByWorkItem(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
};
