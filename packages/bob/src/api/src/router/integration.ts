import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  integrationGet,
  integrationSave,
  integrationDelete,
  integrationList,
} from "../handlers/integration";

export const integrationRouter = {
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      integrationList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1),
      }),
    )
    .query(({ ctx, input }) =>
      integrationGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  save: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1),
        apiKey: z.string().optional(),
        webhookSigningSecret: z.string().optional(),
        linearTeamId: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      integrationSave({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      integrationDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
