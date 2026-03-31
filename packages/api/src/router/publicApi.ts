import { randomBytes, createHash } from "node:crypto";

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import { and, desc, eq, inArray } from "@bob/db";
import {
  agentRuns,
  apiKeys,
  runArtifacts,
  tenants,
  workspaces,
  tenantMembers,
} from "@bob/db/schema";

import {
  protectedProcedure,
  apiKeyReadProcedure,
  apiKeyWriteProcedure,
} from "../trpc";

// Auto-create tenant for new users on first authenticated request.
// Handles concurrent requests by catching unique constraint violations.
async function ensureTenant(db: any, userId: string) {
  let membership = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: { tenant: true },
  });

  if (membership) return membership;

  // Auto-create tenant for new user
  const slug = userId.replace(/[^a-z0-9-]/g, "-").slice(0, 64);
  try {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: slug, slug, plan: "free" })
      .onConflictDoNothing()
      .returning();

    if (tenant) {
      await db
        .insert(tenantMembers)
        .values({ tenantId: tenant.id, userId, role: "owner" })
        .onConflictDoNothing();
    }
  } catch {
    // Concurrent request already created the tenant, re-query
  }

  return db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.userId, userId),
    with: { tenant: true },
  });
}

async function listAuthorizedTenantIds(db: any, userId: string) {
  const memberships = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.userId, userId),
    columns: { tenantId: true },
  });

  return memberships.map((membership: { tenantId: string }) => membership.tenantId);
}

async function assertTenantAccess(db: any, userId: string, tenantId: string | null | undefined) {
  if (!tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const tenantIds = await listAuthorizedTenantIds(db, userId);
  if (!tenantIds.includes(tenantId)) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return tenantIds;
}

export const publicApiRouter = {
  // POST /workspaces — register a workspace
  registerWorkspace: apiKeyWriteProcedure
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
      // Find or auto-create user's tenant
      const membership = await ensureTenant(ctx.db, ctx.session.user.id);
      if (!membership) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create tenant",
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
  createRun: apiKeyWriteProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        workspaceId: z.string().uuid(),
        agentType: z.string().min(1).max(64),
        agentConfig: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // workItemId accepts any string — ForgeGraph work items may use UUIDs,
      // short identifiers (e.g. "BOB-27"), or ForgeGraph-native IDs.
      // We store as-is and resolve at display time.

      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, workspace.tenantId);

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
  updateRun: apiKeyWriteProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        status: z.enum(["running", "completed", "failed"]),
        summary: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingRun = await ctx.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, input.runId),
        columns: { tenantId: true },
      });
      if (!existingRun?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, existingRun.tenantId);

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
  createArtifact: apiKeyWriteProcedure
    .input(
      z.object({
        runId: z.string().uuid(),
        type: z.enum(["diff", "log", "test-report", "file-snapshot"]),
        storageKey: z.string().min(1),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await ctx.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, input.runId),
        columns: { tenantId: true },
      });
      if (!run?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, run.tenantId);

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
  getRun: apiKeyReadProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, input.runId),
        with: { artifacts: true },
      });
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTenantAccess(ctx.db, ctx.session.user.id, run.tenantId);
      return run;
    }),

  // GET /runs — list runs for a workspace
  listRuns: apiKeyReadProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, workspace.tenantId);

      return ctx.db.query.agentRuns.findMany({
        where: and(
          eq(agentRuns.workspaceId, input.workspaceId),
          eq(agentRuns.tenantId, workspace.tenantId),
        ),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),

  // GET /work-items/:id/runs — list runs for a work item
  listRunsByWorkItem: apiKeyReadProcedure
    .input(
      z.object({
        workItemId: z.string().min(1),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantIds = await listAuthorizedTenantIds(ctx.db, ctx.session.user.id);
      if (tenantIds.length === 0) {
        return [];
      }

      return ctx.db.query.agentRuns.findMany({
        where: and(
          eq(agentRuns.workItemId, input.workItemId),
          inArray(agentRuns.tenantId, tenantIds),
        ),
        with: { artifacts: true },
        orderBy: [desc(agentRuns.createdAt)],
        limit: input.limit,
      });
    }),

  // POST /workspaces/:id/heartbeat
  heartbeat: apiKeyWriteProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, workspace.tenantId);

      await ctx.db
        .update(workspaces)
        .set({ lastHeartbeat: new Date() })
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.tenantId, workspace.tenantId),
          ),
        );
      return { ok: true };
    }),

  // POST /api-keys — generate a new API key
  generateApiKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).default("bob-cli"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rawKey = `bob_${randomBytes(32).toString("hex")}`;
      const keyHash = createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);

      const [apiKey] = await ctx.db
        .insert(apiKeys)
        .values({
          userId: ctx.session.user.id,
          name: input.name,
          keyHash,
          keyPrefix,
          permissions: ["read", "write"],
        })
        .returning();

      if (!apiKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create API key",
        });
      }

      // Return the raw key ONCE — it can never be retrieved again
      return { id: apiKey.id, key: rawKey, prefix: keyPrefix };
    }),
};
