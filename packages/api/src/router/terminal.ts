import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { eq, and } from "@bob/db";
import { agentInstances, worktrees } from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const terminalRouter = {
  createAgentSession: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.instanceId),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      if (instance.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot connect to agent terminal. Instance is ${instance.status}. Please start the instance first.`,
        });
      }

      return {
        sessionId: crypto.randomUUID(),
        instanceId: input.instanceId,
        agentType: instance.agentType,
      };
    }),

  createDirectorySession: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.instanceId),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
        with: {
          worktree: true,
        },
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      return {
        sessionId: crypto.randomUUID(),
        instanceId: input.instanceId,
        path: instance.worktree?.path ?? "",
      };
    }),

  createSystemSession: protectedProcedure
    .input(
      z.object({
        cwd: z.string().optional(),
        initialCommand: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return {
        sessionId: crypto.randomUUID(),
        cwd: input.cwd ?? process.env.HOME ?? "/",
        initialCommand: input.initialCommand,
      };
    }),

  listByInstance: protectedProcedure
    .input(z.object({ instanceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.instanceId),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      return [];
    }),

  close: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return { success: true };
    }),
} satisfies TRPCRouterRecord;
