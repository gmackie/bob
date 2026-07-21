import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import {
  integrationDelete,
  integrationFetchLinearTeams,
  integrationGet,
  integrationList,
  integrationSave,
  integrationSetupLinear,
} from "../handlers/integration";
import { protectedProcedure, requireFeature } from "../trpc";

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

  // Provisioning a third-party integration is a paid feature.
  save: requireFeature("integrations")
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        provider: z.string().min(1),
        apiKey: z.string().optional(),
        webhookSigningSecret: z.string().optional(),
        linearTeamId: z.string().optional(),
        linearWebBaseUrl: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      integrationSave({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  fetchLinearTeams: protectedProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      integrationFetchLinearTeams(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  setupLinear: requireFeature("integrations")
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        apiKey: z.string().min(1),
        teamId: z.string().min(1),
        webhookUrl: z.string().url(),
        linearWebBaseUrl: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      integrationSetupLinear(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
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
