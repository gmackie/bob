import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  gitProvidersListConnections,
  gitProvidersConnectPat,
  gitProvidersDisconnect,
  gitProvidersTestConnection,
  gitProvidersSetDefaultForRepo,
  gitProvidersDetectRemote,
} from "../handlers/gitProviders";

const gitProviderSchema = z.enum(["github", "gitlab", "gitea"]);

export const gitProvidersRouter = {
  listConnections: protectedProcedure.query(({ ctx }) =>
    gitProvidersListConnections({ db: ctx.db, userId: ctx.session.user.id }, undefined as void),
  ),

  connectPat: protectedProcedure
    .input(
      z.object({
        provider: gitProviderSchema,
        accessToken: z.string().min(1),
        instanceUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      gitProvidersConnectPat({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  disconnect: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      gitProvidersDisconnect({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  testConnection: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().uuid().optional(),
        provider: gitProviderSchema.optional(),
        instanceUrl: z.string().url().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      gitProvidersTestConnection({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  setDefaultForRepo: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid(),
        connectionId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      gitProvidersSetDefaultForRepo({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  detectRemote: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      gitProvidersDetectRemote({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
