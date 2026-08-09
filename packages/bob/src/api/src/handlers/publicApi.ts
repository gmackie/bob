/**
 * PublicApi handler functions — pure business logic extracted from the tRPC
 * publicApi router.
 *
 * Phase 7B-4D-beta Task 6.
 */
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";

import type { Db } from "@bob/db/client";
import { and, desc, eq, inArray, sql } from "@bob/db";
import {
  agentRuns,
  apiKeys,
  chatConversations,
  discoveredDirs,
  forgeBuilds,
  forgeDeployments,
  forgeRevisions,
  forgeRunEvents,
  projects,
  repositories,
  runArtifacts,
  taskRuns,
  tenantMembers,
  tenants,
  workItems,
  workspaceMembers,
  workspaces,
} from "@bob/db/schema";
import { resolveAgentType } from "@bob/work-items";

import type { HandlerContext } from "./context.js";

/** Matches a canonical UUID, used to decide if a workItemId is joinable. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OodaIntakeSource {
  system: "ooda";
  proposalId: string;
  conversationId: string;
  proposalVersion: number;
  [key: string]: unknown;
}

interface OodaIntakeInput {
  workspaceId: string;
  idempotencyKey: string;
  acceptanceCriteria: string[];
  source: OodaIntakeSource;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function intakeFingerprint(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function replayFingerprint(row: {
  sourceMetadata?: Record<string, unknown> | null;
}): string | null {
  const value = row.sourceMetadata?.commandFingerprint;
  return typeof value === "string" ? value : null;
}

function assertReplayMatches(
  row: { sourceMetadata?: Record<string, unknown> | null },
  fingerprint: string,
): void {
  if (replayFingerprint(row) !== fingerprint) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The idempotency key was already used for a different intake command",
    });
  }
}

interface OodaExecutionEvidence {
  id: string;
  source: "bob" | "kanbanger" | "forgegraph";
  kind: "work_item" | "run" | "revision" | "build" | "deployment" | "run_event";
  externalId: string;
  title: string;
  status: string;
  path: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

function timestamp(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

async function readOodaExecutionEvidence(
  db: Db,
  workItemIds: string[],
): Promise<OodaExecutionEvidence[]> {
  if (workItemIds.length === 0) return [];
  const items = await db.query.workItems.findMany({
    where: inArray(workItems.id, workItemIds),
    columns: { id: true, title: true, status: true, createdAt: true },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));
  const evidence: OodaExecutionEvidence[] = items.map((item) => ({
    id: `kanbanger_work_item:${item.id}`,
    source: "kanbanger",
    kind: "work_item",
    externalId: item.id,
    title: item.title,
    status: item.status,
    path: `/work-items/${encodeURIComponent(item.id)}`,
    occurredAt: timestamp(item.createdAt),
    metadata: {},
  }));
  const runs = await db.query.taskRuns.findMany({
    where: inArray(taskRuns.workItemId, workItemIds),
  });
  for (const run of runs) {
    const item = run.workItemId ? itemById.get(run.workItemId) : undefined;
    if (!item) continue;
    evidence.push({
      id: `bob_run:${run.id}`,
      source: "bob",
      kind: "run",
      externalId: run.id,
      title: `Bob run for ${item.title}`,
      status: run.status,
      path: `/work-items/${encodeURIComponent(item.id)}`,
      occurredAt: timestamp(run.completedAt ?? run.updatedAt ?? run.createdAt),
      metadata: {
        planningItemIdentifier: run.planningItemIdentifier,
        ...(run.branch ? { branch: run.branch } : {}),
        ...(run.blockedReason ? { blockedReason: run.blockedReason } : {}),
      },
    });
  }
  const revisions = await db.query.forgeRevisions.findMany({
    where: inArray(forgeRevisions.taskId, workItemIds),
  });
  const revisionById = new Map(
    revisions.map((revision) => [revision.id, revision]),
  );
  for (const revision of revisions) {
    if (!revision.taskId) continue;
    evidence.push({
      id: `forgegraph_revision:${revision.id}`,
      source: "forgegraph",
      kind: "revision",
      externalId: revision.id,
      title: `ForgeGraph revision ${revision.revId}`,
      status: revision.status,
      path: `/work-items/${encodeURIComponent(revision.taskId)}`,
      occurredAt: timestamp(revision.updatedAt ?? revision.createdAt),
      metadata: {
        revId: revision.revId,
        ...(revision.branch ? { branch: revision.branch } : {}),
        gates: revision.gates ?? [],
      },
    });
  }
  const revisionIds = revisions.map((revision) => revision.id);
  if (revisionIds.length === 0) return evidence;
  const [buildRows, deploymentRows, eventRows] = await Promise.all([
    db.query.forgeBuilds.findMany({
      where: inArray(forgeBuilds.revisionId, revisionIds),
    }),
    db.query.forgeDeployments.findMany({
      where: inArray(forgeDeployments.revisionId, revisionIds),
    }),
    db.query.forgeRunEvents.findMany({
      where: inArray(forgeRunEvents.revisionId, revisionIds),
    }),
  ]);
  for (const build of buildRows) {
    const revision = revisionById.get(build.revisionId);
    if (!revision?.taskId) continue;
    evidence.push({
      id: `forgegraph_build:${build.id}`,
      source: "forgegraph",
      kind: "build",
      externalId: build.id,
      title: "ForgeGraph build",
      status: build.status,
      path: `/work-items/${encodeURIComponent(revision.taskId)}`,
      occurredAt: timestamp(
        build.finishedAt ?? build.updatedAt ?? build.createdAt,
      ),
      metadata: {
        ...(build.imageDigest ? { imageDigest: build.imageDigest } : {}),
        ...(build.artifactManifestRef
          ? { artifactManifestRef: build.artifactManifestRef }
          : {}),
        ...(build.externalJobId ? { externalJobId: build.externalJobId } : {}),
      },
    });
  }
  for (const deployment of deploymentRows) {
    const revision = revisionById.get(deployment.revisionId);
    if (!revision?.taskId) continue;
    evidence.push({
      id: `forgegraph_deployment:${deployment.id}`,
      source: "forgegraph",
      kind: "deployment",
      externalId: deployment.id,
      title: `ForgeGraph ${deployment.environment} deployment`,
      status: deployment.status,
      path: `/work-items/${encodeURIComponent(revision.taskId)}`,
      occurredAt: timestamp(
        deployment.deployedAt ?? deployment.updatedAt ?? deployment.createdAt,
      ),
      metadata: { environment: deployment.environment },
    });
  }
  for (const event of eventRows) {
    const revision = revisionById.get(event.revisionId);
    if (!revision?.taskId) continue;
    evidence.push({
      id: `forgegraph_run_event:${event.id}`,
      source: "forgegraph",
      kind: "run_event",
      externalId: event.id,
      title: `ForgeGraph ${event.eventType.replaceAll("_", " ")}`,
      status: event.testStatus ?? event.eventType,
      path: `/work-items/${encodeURIComponent(revision.taskId)}`,
      occurredAt: timestamp(event.createdAt),
      metadata: {
        eventType: event.eventType,
        artifactRefs: event.artifactRefs ?? [],
      },
    });
  }
  return evidence.sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureTenant(db: Db, userId: string) {
  const membership = await db.query.tenantMembers.findFirst({
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

async function listAuthorizedTenantIds(db: Db, userId: string) {
  const memberships = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.userId, userId),
    columns: { tenantId: true },
  });

  return memberships.map(
    (membership: { tenantId: string }) => membership.tenantId,
  );
}

async function assertTenantAccess(
  db: Db,
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
  db: Db,
  userId: string,
  workspaceId: string,
  tenantId: string,
  repos: {
    name: string;
    path: string;
    isGit: boolean;
    remoteUrl?: string;
    branch?: string;
    dirty?: boolean;
    buildSystem?: string;
    forgeAppId?: string;
  }[],
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

  const { assertWithinQuotaOrThrow } =
    await import("../services/quotas/index.js");
  // A new run counts against monthly task-run volume and concurrent active agents.
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: workspace.tenantId,
    metric: "taskRuns",
  });
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: workspace.tenantId,
    metric: "activeAgents",
  });

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

/**
 * Dispatch an EXECUTABLE Bob session from an external caller (e.g. an OODA
 * thread action). Unlike publicApiCreateRun — which only *records* an
 * agent_runs row and never executes — this creates a live `pending` execution
 * session that the runner picks up and RUNS.
 *
 * That expands what a public API key can do beyond the record-only surface, so
 * it is deliberately conservative:
 *   - Gated behind BOB_OODA_DISPATCH_ENABLED (default off): the capability is
 *     dark until explicitly enabled, so merging/deploying this can't expose
 *     code execution before it's intended.
 *   - Tenant-scoped exactly like the rest of the public API (assertTenantAccess
 *     on the workspace's tenant), so a key can only dispatch into its own tenant.
 *   - Counts against the same taskRuns + activeAgents quotas.
 *   - Carries the caller's opaque correlation (e.g. an OODA threadId) through
 *     personaMetadata.ooda untouched, for the M2 read-back loop.
 * Reuses the proven headless-dispatch shape (work item -> pending execution
 * session -> gateway nudge) from dispatch.ts.
 */
/**
 * Constrain a caller-supplied working directory to a safe root. Dispatched
 * agents run with elevated permissions, so the workingDirectory must stay under
 * /home/bob/dev (where projects + scaffolds live) and contain no `..` segments.
 * Returns the path if allowed, else undefined (caller falls back to default).
 */
export function safeWorkingDirectory(
  dir: string | undefined,
): string | undefined {
  if (!dir) return undefined;
  const trimmed = dir.trim();
  if (!trimmed.startsWith("/home/bob/dev/")) return undefined;
  if (trimmed.includes("..")) return undefined;
  return trimmed;
}

export async function publicApiDispatchExecution(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    title: string;
    description?: string;
    agentType?: string;
    workingDirectory?: string;
    ooda?: { threadId?: string; threadSlug?: string };
  },
) {
  if (process.env.BOB_OODA_DISPATCH_ENABLED !== "true") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "OODA dispatch is disabled. Set BOB_OODA_DISPATCH_ENABLED=true to enable executable dispatch via API key.",
    });
  }

  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  const { assertWithinQuotaOrThrow } =
    await import("../services/quotas/index.js");
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: workspace.tenantId,
    metric: "taskRuns",
  });
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: workspace.tenantId,
    metric: "activeAgents",
  });

  const agentType =
    input.agentType ??
    resolveAgentType({
      workItemOverride: null,
      projectDefault: null,
      workspaceDefault: workspace.defaultAgentType,
    });

  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(workItems)
    .where(eq(workItems.workspaceId, input.workspaceId));
  const sequenceNumber = Number(n) + 1;

  const [workItem] = await ctx.db
    .insert(workItems)
    .values({
      ownerUserId: ctx.userId,
      workspaceId: input.workspaceId,
      kind: "task",
      title: input.title,
      description: input.description ?? null,
      status: "in_progress",
      sequenceNumber,
    })
    .returning();
  if (!workItem) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create work item",
    });
  }
  const identifier = workItem.id.slice(0, 8);

  const workingDirectory =
    safeWorkingDirectory(input.workingDirectory) ?? "/home/bob/dev/gmacko-bob";
  const [session] = await ctx.db
    .insert(chatConversations)
    .values({
      userId: ctx.userId,
      workingDirectory,
      agentType,
      sessionType: "execution",
      status: "pending",
      title: `${identifier}: ${input.title}`,
      workItemId: workItem.id,
      workItemIdentifierSnapshot: identifier,
      // Opaque correlation passthrough for read-back (M2). Nested under
      // `metadata` because that is the only sub-object the gateway forwards to
      // the runner as personaConfig.metadata (relay.ts session_available).
      personaMetadata: input.ooda
        ? { metadata: { ooda: input.ooda } }
        : undefined,
    })
    .returning();
  if (!session) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create execution session",
    });
  }

  // Nudge the gateway to dispatch immediately. Best-effort: the daemon also
  // polls pending sessions, so a failed nudge only delays, never drops.
  const gatewayUrl = process.env.GATEWAY_URL;
  const nudgeSecret = process.env.NUDGE_SHARED_SECRET;
  if (gatewayUrl && nudgeSecret) {
    try {
      await fetch(`${gatewayUrl}/internal/nudge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nudgeSecret}`,
        },
        body: JSON.stringify({
          sessionId: session.id,
          workspaceId: input.workspaceId,
          workingDirectory,
          agentType,
          title: session.title,
          sessionType: "execution",
          description: input.description ?? undefined,
          identifier,
          // Carry the OODA correlation on the nudge path too. The gateway's
          // nudgeSession() forwards `personaConfig` verbatim from this payload
          // (relay.ts) and marks the session delivered, which dedupes the
          // DB-reading deliverPendingSessionsToDaemon path. Without this, a
          // nudge-delivered session reaches the runner with no
          // personaConfig.metadata.ooda, so the M2 read-back silently no-ops.
          personaConfig: input.ooda
            ? { metadata: { ooda: input.ooda } }
            : undefined,
        }),
      });
    } catch {
      // best-effort; the daemon's pending-session poll is the backstop.
    }
  }

  return {
    sessionId: session.id,
    workItemId: workItem.id,
    identifier,
    status: session.status,
  };
}

/**
 * POST /projects — create a Bob (linear-clone) project and seed backlog tasks.
 *
 * The OODA "Make it a project" path: a discussion becomes a real project with a
 * generated key and an initial backlog. Tenant-scoped exactly like the rest of
 * the public API. Seeded tasks land in "backlog" (excluded from auto-drain), so
 * nothing auto-executes without the user promoting it. The create-gmacko-app
 * scaffold is a separate executable dispatch (publicApiDispatchExecution),
 * kicked by the caller when requested.
 */
export async function publicApiCreateProject(
  ctx: HandlerContext,
  input: OodaIntakeInput & {
    workspaceId: string;
    name: string;
    description?: string;
    color?: string;
    tasks?: string[];
  },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  const commandFingerprint = intakeFingerprint(input);
  const replay = await ctx.db.query.projects.findFirst({
    where: and(
      eq(projects.workspaceId, input.workspaceId),
      eq(projects.externalProvider, "ooda"),
      eq(projects.externalId, input.idempotencyKey),
    ),
  });
  if (replay) {
    assertReplayMatches(replay, commandFingerprint);
    const replayItems = await ctx.db.query.workItems.findMany({
      where: eq(workItems.projectId, replay.id),
      columns: { id: true, title: true },
    });
    return {
      kind: "project" as const,
      id: replay.id,
      projectId: replay.id,
      key: replay.key,
      name: replay.name,
      status: replay.status,
      workItems: replayItems,
      replayed: true,
    };
  }

  try {
    return await ctx.db.transaction(async (tx) => {
      // Unique project key (<=16 chars), collision-suffixed within the workspace.
      const baseKey =
        input.name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 12) || "PROJ";
      let key = baseKey;
      for (let suffix = 2; suffix <= 99; suffix++) {
        const conflict = await tx.query.projects.findFirst({
          where: and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.key, key),
          ),
          columns: { id: true },
        });
        if (!conflict) break;
        key = `${baseKey}${suffix}`.slice(0, 16);
      }

      const [project] = await tx
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          key,
          description: input.description ?? null,
          color: input.color ?? null,
          status: "active",
          externalProvider: "ooda",
          externalId: input.idempotencyKey,
          sourceMetadata: {
            ...input.source,
            acceptanceCriteria: input.acceptanceCriteria,
            commandFingerprint,
          },
        })
        .returning();
      if (!project) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create project",
        });
      }

      // Project and seeded backlog are one commit: a replay never observes a
      // durable project whose approved initial task set was only half written.
      const taskTitles = (input.tasks ?? [])
        .map((title) => title.trim())
        .filter(Boolean)
        .slice(0, 20);
      const createdWorkItems: { id: string; title: string }[] = [];
      if (taskTitles.length > 0) {
        const [{ n } = { n: 0 }] = await tx
          .select({ n: sql<number>`count(*)` })
          .from(workItems)
          .where(eq(workItems.workspaceId, input.workspaceId));
        let sequence = Number(n);
        for (const title of taskTitles) {
          sequence += 1;
          const [workItem] = await tx
            .insert(workItems)
            .values({
              ownerUserId: ctx.userId,
              workspaceId: input.workspaceId,
              projectId: project.id,
              kind: "task",
              title: title.slice(0, 256),
              status: "backlog",
              sequenceNumber: sequence,
            })
            .returning({ id: workItems.id, title: workItems.title });
          if (workItem) createdWorkItems.push(workItem);
        }
      }
      return {
        kind: "project" as const,
        id: project.id,
        projectId: project.id,
        key: project.key,
        name: project.name,
        status: project.status,
        workItems: createdWorkItems,
        replayed: false,
      };
    });
  } catch (error) {
    // A concurrent delivery may have committed after our first replay check.
    // Resolve the destination identity instead of surfacing its unique-index
    // race as a failed delivery.
    const concurrentReplay = await ctx.db.query.projects.findFirst({
      where: and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.externalProvider, "ooda"),
        eq(projects.externalId, input.idempotencyKey),
      ),
    });
    if (!concurrentReplay) throw error;
    assertReplayMatches(concurrentReplay, commandFingerprint);
    const replayItems = await ctx.db.query.workItems.findMany({
      where: eq(workItems.projectId, concurrentReplay.id),
      columns: { id: true, title: true },
    });
    return {
      kind: "project" as const,
      id: concurrentReplay.id,
      projectId: concurrentReplay.id,
      key: concurrentReplay.key,
      name: concurrentReplay.name,
      status: concurrentReplay.status,
      workItems: replayItems,
      replayed: true,
    };
  }
}

/** Create one durable Bob backlog task from an approved OODA proposal. */
export async function publicApiCreateTask(
  ctx: HandlerContext,
  input: OodaIntakeInput & {
    title: string;
    description?: string;
    projectId?: string;
  },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) throw new TRPCError({ code: "NOT_FOUND" });
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  if (input.projectId) {
    const project = await ctx.db.query.projects.findFirst({
      where: and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
      columns: { id: true },
    });
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  }

  const commandFingerprint = intakeFingerprint(input);
  const replay = await ctx.db.query.workItems.findFirst({
    where: and(
      eq(workItems.workspaceId, input.workspaceId),
      eq(workItems.externalProvider, "ooda"),
      eq(workItems.externalId, input.idempotencyKey),
    ),
  });
  if (replay) {
    assertReplayMatches(replay, commandFingerprint);
    return {
      kind: "work_item" as const,
      id: replay.id,
      title: replay.title,
      status: replay.status,
      replayed: true,
    };
  }

  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(workItems)
    .where(eq(workItems.workspaceId, input.workspaceId));
  try {
    const [workItem] = await ctx.db
      .insert(workItems)
      .values({
        ownerUserId: ctx.userId,
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        kind: "task",
        title: input.title,
        description: input.description ?? null,
        status: "backlog",
        sequenceNumber: Number(n) + 1,
        externalProvider: "ooda",
        externalId: input.idempotencyKey,
        sourceMetadata: {
          ...input.source,
          acceptanceCriteria: input.acceptanceCriteria,
          commandFingerprint,
        },
      })
      .returning();
    if (!workItem) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create work item",
      });
    }
    return {
      kind: "work_item" as const,
      id: workItem.id,
      title: workItem.title,
      status: workItem.status,
      replayed: false,
    };
  } catch (error) {
    const concurrentReplay = await ctx.db.query.workItems.findFirst({
      where: and(
        eq(workItems.workspaceId, input.workspaceId),
        eq(workItems.externalProvider, "ooda"),
        eq(workItems.externalId, input.idempotencyKey),
      ),
    });
    if (!concurrentReplay) throw error;
    assertReplayMatches(concurrentReplay, commandFingerprint);
    return {
      kind: "work_item" as const,
      id: concurrentReplay.id,
      title: concurrentReplay.title,
      status: concurrentReplay.status,
      replayed: true,
    };
  }
}

/** Resolve Bob's durable destination record after an ambiguous caller timeout. */
export async function publicApiLookupIntake(
  ctx: HandlerContext,
  input: { workspaceId: string; idempotencyKey: string },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) throw new TRPCError({ code: "NOT_FOUND" });
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  const project = await ctx.db.query.projects.findFirst({
    where: and(
      eq(projects.workspaceId, input.workspaceId),
      eq(projects.externalProvider, "ooda"),
      eq(projects.externalId, input.idempotencyKey),
    ),
  });
  if (project) {
    const projectItems = await ctx.db.query.workItems.findMany({
      where: eq(workItems.projectId, project.id),
      columns: { id: true },
    });
    return {
      kind: "project" as const,
      id: project.id,
      key: project.key,
      name: project.name,
      status: project.status,
      replayed: true,
      evidence: await readOodaExecutionEvidence(
        ctx.db,
        projectItems.map((item) => item.id),
      ),
    };
  }
  const workItem = await ctx.db.query.workItems.findFirst({
    where: and(
      eq(workItems.workspaceId, input.workspaceId),
      eq(workItems.externalProvider, "ooda"),
      eq(workItems.externalId, input.idempotencyKey),
    ),
  });
  if (!workItem) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    kind: "work_item" as const,
    id: workItem.id,
    title: workItem.title,
    status: workItem.status,
    replayed: true,
    evidence: await readOodaExecutionEvidence(ctx.db, [workItem.id]),
  };
}

/**
 * GET /projects — list a workspace's (linear-clone) projects. Lets an agent /
 * caller discover active projects to file tasks against.
 */
export async function publicApiListProjects(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  const rows = await ctx.db.query.projects.findMany({
    where: eq(projects.workspaceId, input.workspaceId),
    columns: { id: true, key: true, name: true, status: true },
    orderBy: desc(projects.createdAt),
    limit: 100,
  });
  return { projects: rows };
}

/**
 * POST /work-items — create a single task, optionally under an existing project.
 * The in-conversation "file this as a task" path. Defaults to "backlog" status
 * (excluded from auto-drain), so nothing auto-executes without promotion.
 */
export async function publicApiCreateWorkItem(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    projectId?: string;
    title: string;
    description?: string;
    status?: string;
  },
) {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, input.workspaceId),
  });
  if (!workspace?.tenantId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertTenantAccess(ctx.db, ctx.userId, workspace.tenantId);

  if (input.projectId) {
    const proj = await ctx.db.query.projects.findFirst({
      where: and(
        eq(projects.id, input.projectId),
        eq(projects.workspaceId, input.workspaceId),
      ),
      columns: { id: true },
    });
    if (!proj) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "project not found in workspace",
      });
    }
  }

  const [{ n } = { n: 0 }] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(workItems)
    .where(eq(workItems.workspaceId, input.workspaceId));

  const [wi] = await ctx.db
    .insert(workItems)
    .values({
      ownerUserId: ctx.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      kind: "task",
      title: input.title.slice(0, 256),
      description: input.description ?? null,
      status: input.status ?? "backlog",
      sequenceNumber: Number(n) + 1,
    })
    .returning({
      id: workItems.id,
      title: workItems.title,
      status: workItems.status,
    });
  if (!wi) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create work item",
    });
  }
  return { workItemId: wi.id, title: wi.title, status: wi.status };
}

export async function publicApiUpdateRun(
  ctx: HandlerContext,
  input: {
    runId: string;
    status:
      | "queued"
      | "running"
      | "blocked"
      | "completed"
      | "failed"
      | "interrupted"
      | "host_unknown";
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
  // Terminal outcomes stamp completedAt. "interrupted" is terminal;
  // "blocked" and "host_unknown" are NOT (the run is paused / contact lost,
  // not finished), so they leave completedAt untouched.
  if (
    input.status === "completed" ||
    input.status === "failed" ||
    input.status === "interrupted"
  )
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

  const sizeBytes =
    typeof input.metadata?.sizeBytes === "number" &&
    Number.isFinite(input.metadata.sizeBytes)
      ? Math.max(0, Math.floor(input.metadata.sizeBytes))
      : 1024;
  const { assertWithinQuotaOrThrow } =
    await import("../services/quotas/index.js");
  await assertWithinQuotaOrThrow({
    db: ctx.db,
    tenantId: run.tenantId,
    metric: "storageBytes",
    delta: sizeBytes,
  });

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
    repos?: {
      name: string;
      path: string;
      isGit: boolean;
      remoteUrl?: string;
      branch?: string;
      dirty?: boolean;
      buildSystem?: string;
      forgeAppId?: string;
    }[];
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
