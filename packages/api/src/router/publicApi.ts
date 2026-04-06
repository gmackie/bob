import { randomBytes, createHash } from "node:crypto";

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import { and, desc, eq, inArray } from "@bob/db";
import {
  agentRuns,
  apiKeys,
  discoveredDirs,
  projects,
  repositories,
  runArtifacts,
  tenants,
  workspaces,
  tenantMembers,
  workspaceMembers,
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

async function processDiscoveredRepos(
  db: any,
  userId: string,
  workspaceId: string,
  tenantId: string,
  repos: Array<{
    name: string;
    path: string;
    isGit: boolean;
    remoteUrl?: string;
    branch?: string;
    dirty?: boolean;
    buildSystem?: string;
    forgeAppId?: string;
  }>,
) {
  const gitRepos = repos.filter((r) => r.isGit);
  const nonGitDirs = repos.filter((r) => !r.isGit);

  // Mark all existing repos for this workspace as stale, then un-stale the ones we see.
  // Only do this if we have repos to process — an empty array (scanner failure) should
  // not mark everything as stale.
  if (gitRepos.length > 0) {
    await db
      .update(repositories)
      .set({ stale: true })
      .where(eq(repositories.workspaceId, workspaceId));
  }

  for (const repo of gitRepos) {
    // Upsert repository record
    const existing = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.workspaceId, workspaceId),
        eq(repositories.path, repo.path),
      ),
    });

    if (existing) {
      await db
        .update(repositories)
        .set({
          remoteUrl: repo.remoteUrl ?? existing.remoteUrl,
          branch: repo.branch ?? existing.branch,
          dirty: repo.dirty ?? false,
          buildSystem: repo.buildSystem ?? existing.buildSystem,
          stale: false,
        })
        .where(eq(repositories.id, existing.id));
    } else {
      await db.insert(repositories).values({
        userId,
        workspaceId,
        name: repo.name,
        path: repo.path,
        branch: repo.branch ?? "main",
        mainBranch: repo.branch ?? "main",
        remoteUrl: repo.remoteUrl,
        buildSystem: repo.buildSystem,
        dirty: repo.dirty ?? false,
        stale: false,
        discoveryStatus: "discovered",
      });
    }

    // Auto-create project for ForgeGraph-linked repos
    if (repo.forgeAppId) {
      const existingProject = await db.query.projects.findFirst({
        where: and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.forgeGraphAppId, repo.forgeAppId),
        ),
      });

      if (!existingProject) {
        // Generate a key from the repo name (uppercase, alphanumeric, max 16)
        const baseKey = repo.name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 14) || "PROJ";

        // Find a unique key, appending a numeric suffix on collision
        let key = baseKey;
        for (let suffix = 2; suffix <= 99; suffix++) {
          const conflict = await db.query.projects.findFirst({
            where: and(
              eq(projects.workspaceId, workspaceId),
              eq(projects.key, key),
            ),
          });
          if (!conflict) break;
          key = `${baseKey}${suffix}`;
        }

        const [newProject] = await db
          .insert(projects)
          .values({
            workspaceId,
            forgeGraphAppId: repo.forgeAppId,
            name: repo.name,
            key,
            repoUrl: repo.remoteUrl,
            status: "active",
          })
          .returning();

        // Link the repository to the project
        if (newProject) {
          await db
            .update(repositories)
            .set({ planningProjectId: newProject.id })
            .where(
              and(
                eq(repositories.workspaceId, workspaceId),
                eq(repositories.path, repo.path),
              ),
            );
        }
      }
    }
  }

  // Upsert non-git directories
  for (const dir of nonGitDirs) {
    await db
      .insert(discoveredDirs)
      .values({
        workspaceId,
        path: dir.path,
        name: dir.name,
        lastSeen: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [discoveredDirs.workspaceId, discoveredDirs.path],
        set: { lastSeen: new Date().toISOString() },
      });
  }
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
          lastHeartbeat: new Date().toISOString(),
        })
        .returning();

      if (!workspace) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workspace",
        });
      }

      await ctx.db
        .insert(workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: ctx.session.user.id,
          role: "owner",
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
    .input(z.object({
      workspaceId: z.string().uuid(),
      agentTypes: z.array(z.string()).optional(),
      forgeAvailable: z.boolean().optional(),
      repos: z.array(z.object({
        name: z.string(),
        path: z.string(),
        isGit: z.boolean(),
        remoteUrl: z.string().optional(),
        branch: z.string().optional(),
        dirty: z.boolean().optional(),
        buildSystem: z.string().optional(),
        forgeAppId: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const workspace = await ctx.db.query.workspaces.findFirst({
        where: eq(workspaces.id, input.workspaceId),
      });
      if (!workspace?.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await assertTenantAccess(ctx.db, ctx.session.user.id, workspace.tenantId);

      const updates: Record<string, unknown> = {
        lastHeartbeat: new Date().toISOString(),
      };

      if (input.agentTypes && input.agentTypes.length > 0) {
        const agentConfigs: Record<string, unknown> = {};
        for (const agent of input.agentTypes) {
          agentConfigs[agent] = { available: true };
        }
        updates.agentConfigs = agentConfigs;
      }

      if (input.forgeAvailable !== undefined) {
        updates.forgeAvailable = input.forgeAvailable;
      }

      await ctx.db
        .update(workspaces)
        .set(updates)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.tenantId, workspace.tenantId),
          ),
        );

      // Process discovered repos
      if (input.repos && input.repos.length > 0) {
        await processDiscoveredRepos(ctx.db, ctx.session.user.id, input.workspaceId, workspace.tenantId, input.repos);
      }

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
