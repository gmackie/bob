import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { protectedProcedure } from "../trpc";
import {
  terminalCreateAgentSession,
  terminalCreateDirectorySession,
  terminalCreateSystemSession,
  terminalListByInstance,
  terminalClose,
} from "../handlers/terminal";

export const terminalRouter = {
  createAgentSession: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      terminalCreateAgentSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createDirectorySession: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      terminalCreateDirectorySession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createSystemSession: protectedProcedure
    .input(
      z.object({
        cwd: z.string().optional(),
        initialCommand: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      terminalCreateSystemSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  listByInstance: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      terminalListByInstance({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  close: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      terminalClose({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
