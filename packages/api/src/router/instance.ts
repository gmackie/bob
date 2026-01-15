import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { desc, eq, and } from "@bob/db";
import {
  agentInstances,
  worktrees,
  repositories,
  agentTypeEnum,
  instanceStatusEnum,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const instanceRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    const instances = await ctx.db.query.agentInstances.findMany({
      where: eq(agentInstances.userId, ctx.session.user.id),
      orderBy: desc(agentInstances.createdAt),
    });
    return instances;
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.id),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      return instance;
    }),

  byRepository: protectedProcedure
    .input(z.object({ repositoryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instances = await ctx.db.query.agentInstances.findMany({
        where: and(
          eq(agentInstances.repositoryId, input.repositoryId),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
        orderBy: desc(agentInstances.createdAt),
      });
      return instances;
    }),

  byWorktree: protectedProcedure
    .input(z.object({ worktreeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const instances = await ctx.db.query.agentInstances.findMany({
        where: and(
          eq(agentInstances.worktreeId, input.worktreeId),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
        orderBy: desc(agentInstances.createdAt),
      });
      return instances;
    }),

  start: protectedProcedure
    .input(
      z.object({
        worktreeId: z.string().uuid(),
        agentType: z.enum(agentTypeEnum).optional().default("claude"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wt = await ctx.db.query.worktrees.findFirst({
        where: and(
          eq(worktrees.id, input.worktreeId),
          eq(worktrees.userId, ctx.session.user.id)
        ),
      });

      if (!wt) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Worktree not found" });
      }

      const [instance] = await ctx.db
        .insert(agentInstances)
        .values({
          userId: ctx.session.user.id,
          repositoryId: wt.repositoryId,
          worktreeId: input.worktreeId,
          agentType: input.agentType,
          status: "starting",
        })
        .returning();

      return instance;
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.id),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      const [updated] = await ctx.db
        .update(agentInstances)
        .set({ status: "stopped", pid: null })
        .where(eq(agentInstances.id, input.id))
        .returning();

      return updated;
    }),

  restart: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const instance = await ctx.db.query.agentInstances.findFirst({
        where: and(
          eq(agentInstances.id, input.id),
          eq(agentInstances.userId, ctx.session.user.id)
        ),
      });

      if (!instance) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      const [updated] = await ctx.db
        .update(agentInstances)
        .set({ status: "starting", pid: null })
        .where(eq(agentInstances.id, input.id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(agentInstances)
        .where(
          and(
            eq(agentInstances.id, input.id),
            eq(agentInstances.userId, ctx.session.user.id)
          )
        );
      return { success: true };
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(instanceStatusEnum),
        pid: z.number().optional(),
        errorMessage: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(agentInstances)
        .set({
          status: input.status,
          pid: input.pid ?? null,
          errorMessage: input.errorMessage ?? null,
          lastActivity: new Date(),
        })
        .where(
          and(
            eq(agentInstances.id, input.id),
            eq(agentInstances.userId, ctx.session.user.id)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
      }

      return updated;
    }),
} satisfies TRPCRouterRecord;
