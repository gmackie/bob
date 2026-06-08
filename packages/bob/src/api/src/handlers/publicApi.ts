/**
 * PublicApi handler functions — pure business logic extracted from the tRPC
 * publicApi router.
 *
 * Phase 7B-4D-beta Task 6.
 */
import { randomBytes, createHash } from "node:crypto";

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
  workItems,
  workspaces,
  tenantMembers,
  workspaceMembers,
} from "@bob/db/schema";
import { resolveAgentType } from "@bob/work-items";

import type { HandlerContext } from "./context.js";

/** Matches a canonical UUID, used to decide if a workItemId is joinable. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

  return memberships.map(
    (membership: { tenantId: string }) => membership.tenantId,
  );
}

async function assertTenantAccess(
  db: any,
  userId: string,
  tenantId: string | null | undefined,
) {
  if (!tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const tenantIds = await listAuthorizedTenantIds(db, userId);
  if (!tenantIds.includes(tenantId)) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return tenantIds;
}

async function notifyWorkspaceEvent(input: {
  type: string;
  workspaceId: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const gatewayUrl = process.env.GATEWAY_URL;
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (!gatewayUrl || !nudgeSecret) return;

  try {
    await fetch(`${gatewayUrl}/internal/workspace-event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nudgeSecret}`,
      },
      body: JSON.stringify(input),
    });
  } catch (err) {
    console.warn("[publicApi] workspace event notification failed:", err);
  }
}

async function notifyAgentRunChanged(input: {
  workspaceId?: string | null;
  runId?: string | null;
  status?: string | null;
  agentType?: string | null;
  workItemId?: string | null;
}) {
  if (!input.workspaceId || !input.runId) return;

  await notifyWorkspaceEvent({
    type: "provider_capacity_changed",
    workspaceId: input.workspaceId,
    entityId: input.runId,
    payload: {
      changed: ["agentRun"],
      runId: input.runId,
      status: input.status ?? null,
      agentType: input.agentType ?? null,
      workItemId: input.workItemId ?? null,
    },
  });
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
  const changedRepositoryIds = new Set<string>();

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
      changedRepositoryIds.add(existing.id);
    } else {
      const [inserted] = await db
        .insert(repositories)
        .values({
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
        })
        .returning();
      if (inserted?.id) changedRepositoryIds.add(inserted.id);
    }

    // Auto-create project for ForgeGraph-linked repos
    if (repo.forgeAppId) {
      const existingProject = await db.query.projects.findFirst({
        where: eq(projects.forgeGraphAppId, repo.forgeAppId),
      });

      if (!existingProject) {
        // Generate a key from the repo name (uppercase, alphanumeric, max 16)
        const baseKey =
          repo.name
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

  return {
    repositoryIds: [...changedRepositoryIds],
  };
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function publicApiRegisterWorkspace(
  ctx: HandlerContext,
  input: {
    name: string;
    slug: string;
    machineId: string;
    repoPath?: string;
  },
) {
  // Find or auto-create user's tenant
  const membership = await ensureTenant(ctx.db, ctx.userId);
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
      ownerUserId: ctx.userId,
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
      userId: ctx.userId,
      role: "owner",
    })
    .returning();

  return workspace;
}

export async function publicApiCreateRun(
  ctx: HandlerContext,
  input: {
    workItemId: string;
    workspaceId: string;
    agentType?: string;
    agentConfig?: Record<string, unknown>;
  },
) {
  // workItemId accepts any string — ForgeGraph work items may use UUIDs,
  // short identifiers (e.g. "BOB-27"), or ForgeGraph-native IDs.
  // We store as-is and resolve at display time.

  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  // Resolve the effective agent when the caller didn't pin one explicitly:
  // work-item override -> project default -> workspace default -> fallback.
  let agentType = input.agentType;
  if (!agentType) {
    let workItemOverride: string | null = null;
    let projectDefault: string | null = null;
    // Match by UUID when given one, else by externalId (Linear/ForgeGraph
    // synced items pass an external identifier like "BOB-27").
    const wi = await ctx.db.query.workItems.findFirst({
      where: UUID_RE.test(input.workItemId)
        ? eq(workItems.id, input.workItemId)
        : eq(workItems.externalId, input.workItemId),
      columns: { agentTypeOverride: true, projectId: true },
    });
    if (wi) {
      workItemOverride = wi.agentTypeOverride ?? null;
      if (wi.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, wi.projectId),
          columns: { defaultAgentType: true },
        });
        projectDefault = project?.defaultAgentType ?? null;
      }
    }
    agentType = resolveAgentType({
      workItemOverride,
      projectDefault,
      workspaceDefault: workspace.defaultAgentType,
    });
  }

  const [run] = await ctx.db
    .insert(agentRuns)
    .values({
      workItemId: input.workItemId,
      workspaceId: input.workspaceId,
      tenantId: workspace.tenantId,
      agentType,
      agentConfig: input.agentConfig ?? {},
      status: "queued",
    })
    .returning();

  await notifyAgentRunChanged({
    workspaceId: run?.workspaceId ?? input.workspaceId,
    runId: run?.id,
    status: run?.status ?? "queued",
    agentType: run?.agentType ?? agentType,
    workItemId: run?.workItemId ?? input.workItemId,
  });

  return run;
}

export async function publicApiUpdateRun(
  ctx: HandlerContext,
  input: {
    runId: string;
    status: "running" | "completed" | "failed";
    summary?: Record<string, unknown>;
  },
) {
  const existingRun = await ctx.db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, input.runId),
    columns: {
      tenantId: true,
      workspaceId: true,
      workItemId: true,
      agentType: true,
    },
  });
  if (!existingRun?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, existingRun.tenantId);

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

  await notifyAgentRunChanged({
    workspaceId: updated?.workspaceId ?? existingRun.workspaceId,
    runId: updated?.id ?? input.runId,
    status: updated?.status ?? input.status,
    agentType: updated?.agentType ?? existingRun.agentType,
    workItemId: updated?.workItemId ?? existingRun.workItemId,
  });

  return updated;
}

export async function publicApiCreateArtifact(
  ctx: HandlerContext,
  input: {
    runId: string;
    type: "diff" | "log" | "test-report" | "file-snapshot";
    storageKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  const run = await ctx.db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, input.runId),
    columns: {
      tenantId: true,
      workspaceId: true,
      workItemId: true,
      sessionId: true,
    },
  });
  if (!run?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, run.tenantId);

  const [artifact] = await ctx.db
    .insert(runArtifacts)
    .values({
      runId: input.runId,
      type: input.type,
      storageKey: input.storageKey,
      metadata: input.metadata ?? {},
    })
    .returning();

  if (run.workspaceId) {
    await notifyWorkspaceEvent({
      type: "session_event_appended",
      workspaceId: run.workspaceId,
      entityId: run.sessionId ?? input.runId,
      payload: {
        changed: ["artifact"],
        runId: input.runId,
        artifactId: artifact?.id ?? null,
        artifactType: artifact?.type ?? input.type,
        workItemId: run.workItemId ?? null,
      },
    });
  }

  return artifact;
}

export async function publicApiGetRun(
  ctx: HandlerContext,
  input: { runId: string },
) {
  const run = await ctx.db.query.agentRuns.findFirst({
    where: eq(agentRuns.id, input.runId),
    with: { artifacts: true },
  });
  if (!run) throw new TRPCError({ code: "NOT_FOUND" });
  await assertTenantAccess(ctx.db, ctx.userId, run.tenantId);
  return run;
}

export async function publicApiListRuns(
  ctx: HandlerContext,
  input: { workspaceId: string; limit: number },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  return ctx.db.query.agentRuns.findMany({
    where: and(
      eq(agentRuns.workspaceId, input.workspaceId),
      eq(agentRuns.tenantId, workspace.tenantId),
    ),
    with: { artifacts: true },
    orderBy: [desc(agentRuns.createdAt)],
    limit: input.limit,
  });
}

export async function publicApiListRunsByWorkItem(
  ctx: HandlerContext,
  input: { workItemId: string; limit: number },
) {
  const tenantIds = await listAuthorizedTenantIds(ctx.db, ctx.userId);
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
}

export async function publicApiHeartbeat(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    agentTypes?: string[];
    forgeAvailable?: boolean;
    repos?: Array<{
      name: string;
      path: string;
      isGit: boolean;
      remoteUrl?: string;
      branch?: string;
      dirty?: boolean;
      buildSystem?: string;
      forgeAppId?: string;
    }>;
  },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

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
    const discovery = await processDiscoveredRepos(
      ctx.db,
      ctx.userId,
      input.workspaceId,
      workspace.tenantId,
      input.repos,
    );

    if (discovery.repositoryIds.length > 0) {
      await notifyWorkspaceEvent({
        type: "git_status_changed",
        workspaceId: input.workspaceId,
        entityId: discovery.repositoryIds[0],
        payload: {
          changed: ["repository", "gitStatus"],
          repositoryIds: discovery.repositoryIds,
        },
      });
    }
  }

  return { ok: true };
}

export async function publicApiGenerateApiKey(
  ctx: HandlerContext,
  input: { name: string },
) {
  const rawKey = `bob_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);

  const [apiKey] = await ctx.db
    .insert(apiKeys)
    .values({
      userId: ctx.userId,
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
}
