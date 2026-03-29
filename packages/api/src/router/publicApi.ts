import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import { desc, eq } from "@bob/db";
import {
  agentRuns,
  runArtifacts,
  workspaces,
  tenantMembers,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const publicApiRouter = {
  // POST /workspaces — register a workspace
  registerWorkspace: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(64),
        machineId: z.string().min(1),
        repoPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find user's tenant
      const membership = await ctx.db.query.tenantMembers.findFirst({
        where: eq(tenantMembers.userId, ctx.session.user.id),
        with: { tenant: true },
      });
      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No tenant found for user",
        });
      }

      const [workspace] = await ctx.db
        .insert(workspaces)
        .values({
          name: input.name,
          slug: input.slug,
          ownerUserId: ctx.session.user.id,
          tenantId: membership.tenantId,
          machineId: input.machineId,
          lastHeartbeat: new Date(),
        })
        .returning();

      return workspace;
    }),

  // POST /runs — create an agent run
  createRun: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        workspaceId: z.string().uuid(),
        agentType: z.string().min(1).max(64),
        agentConfig: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify workspace belongs to user's tenant
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [run] = await ctx.db
        .insert(agentRuns)
        .values({
          workItemId: input.workItemId,
          workspaceId: input.workspaceId,
          tenantId: workspace.tenantId,
          agentType: input.agentType,
          agentConfig: input.agentConfig ?? {},
          status: "queued",
        })
        .returning();

      return run;
    }),

  // PATCH /runs/:id — update run status
  updateRun: protectedProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        status: z.enum(["running", "completed", "failed"]),
        summary: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const updates: Record<string, unknown> = { status: input.status };

      if (input.status === "running") updates.startedAt = now;
      if (input.status === "completed" || input.status === "failed")
        updates.completedAt = now;
      if (input.summary) updates.summary = input.summary;

      const [updated] = await ctx.db
        .update(agentRuns)
        .set(updates)
        .where(eq(agentRuns.id, input.runId))
        .returning();

      return updated;
    }),

  // POST /runs/:id/artifacts — upload artifact metadata
  createArtifact: protectedProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        type: z.enum(["diff", "log", "test-report", "file-snapshot"]),
        storageKey: z.string().min(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [artifact] = await ctx.db
        .insert(runArtifacts)
        .values({
          runId: input.runId,
          type: input.type,
          storageKey: input.storageKey,
          metadata: input.metadata ?? {},
        })
        .returning();

      return artifact;
    }),

  // GET /runs/:id — get run with artifacts
  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, input.runId),
        with: { artifacts: true },
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),

  // GET /runs — list runs for a workspace
  listRuns: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.agentRuns.findMany({
        where: eq(agentRuns.workspaceId, input.workspaceId),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),

  // POST /workspaces/:id/heartbeat
  heartbeat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(workspaces)
        .set({ lastHeartbeat: new Date() })
        .where(eq(workspaces.id, input.workspaceId));
      return { ok: true };
    }),
};
