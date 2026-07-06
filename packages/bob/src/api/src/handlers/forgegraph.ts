/**
 * ForgeGraph handler functions — pure business logic extracted from the tRPC
 * forgegraph router.
 *
 * Phase 7B-4D-beta Task 8.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "@bob/db";
import {
  activities,
  dispatchItems,
  forgeRevisions,
  forgeBuilds,
  forgeDeployments,
  forgeRunEvents,
  projects,
  repositories,
} from "@bob/db/schema";
import { getForgeGraphClient } from "../services/forgegraph/config";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function forgegraphListRevisions(
  ctx: HandlerContext,
  input: {
    repoId?: string;
    taskId?: string;
    limit: number;
  },
) {
  const conditions = [];
  if (input.repoId)
    conditions.push(eq(forgeRevisions.repoId, input.repoId));
  if (input.taskId)
    conditions.push(eq(forgeRevisions.taskId, input.taskId));

  return ctx.db.query.forgeRevisions.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(forgeRevisions.createdAt)],
    limit: input.limit,
  });
}

export async function forgegraphGetRevision(
  ctx: HandlerContext,
  input: { repoId: string; revId: string },
) {
  return ctx.db.query.forgeRevisions.findFirst({
    where: and(
      eq(forgeRevisions.repoId, input.repoId),
      eq(forgeRevisions.revId, input.revId),
    ),
    with: {
      builds: true,
      deployments: true,
      runEvents: true,
    },
  });
}

export async function forgegraphCreateRevision(
  ctx: HandlerContext,
  input: {
    repoId: string;
    revId: string;
    taskId?: string;
    taskRunId?: string;
    branch?: string;
  },
) {
  const [revision] = await ctx.db
    .insert(forgeRevisions)
    .values({
      repoId: input.repoId,
      revId: input.revId,
      taskId: input.taskId,
      taskRunId: input.taskRunId,
      branch: input.branch,
    })
    .onConflictDoUpdate({
      target: [forgeRevisions.repoId, forgeRevisions.revId],
      set: {
        taskId: input.taskId,
        taskRunId: input.taskRunId,
        branch: input.branch,
      },
    })
    .returning();

  if (!revision) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create forge revision",
    });
  }

  return revision;
}

export async function forgegraphTriggerBuild(
  ctx: HandlerContext,
  input: {
    revisionId: string;
    repoId: string;
    idempotencyKey: string;
    ciProvider?: string;
    taskId?: string;
  },
) {
  const [build] = await ctx.db
    .insert(forgeBuilds)
    .values({
      revisionId: input.revisionId,
      repoId: input.repoId,
      idempotencyKey: input.idempotencyKey,
      ciProvider: input.ciProvider,
    })
    .onConflictDoNothing({
      target: [forgeBuilds.idempotencyKey],
    })
    .returning();

  if (!build) {
    // Idempotency conflict — return existing build
    return ctx.db.query.forgeBuilds.findFirst({
      where: eq(forgeBuilds.idempotencyKey, input.idempotencyKey),
    });
  }
  return build;
}

export async function forgegraphUpdateBuildStatus(
  ctx: HandlerContext,
  input: {
    buildId: string;
    status: string;
    imageDigest?: string;
    externalJobId?: string;
  },
) {
  const [updated] = await ctx.db
    .update(forgeBuilds)
    .set({
      status: input.status,
      imageDigest: input.imageDigest,
      externalJobId: input.externalJobId,
    })
    .where(eq(forgeBuilds.id, input.buildId))
    .returning();

  // Emit activity event if the build is linked to a work item via its revision
  if (updated) {
    const revision = await ctx.db.query.forgeRevisions.findFirst({
      where: eq(forgeRevisions.id, updated.revisionId),
    });
    if (revision?.taskId) {
      await ctx.db.insert(activities).values({
        workItemId: revision.taskId,
        type: "build_status_changed",
        toValue: input.status,
        metadata: {
          buildId: input.buildId,
          status: input.status,
          revisionId: revision.id,
        },
      });
    }
  }

  return updated;
}

export async function forgegraphCreateDeployment(
  ctx: HandlerContext,
  input: {
    revisionId: string;
    buildId: string;
    repoId: string;
    environment: string;
    rollbackTargetId?: string;
  },
) {
  const [deployment] = await ctx.db
    .insert(forgeDeployments)
    .values({
      revisionId: input.revisionId,
      buildId: input.buildId,
      repoId: input.repoId,
      environment: input.environment,
      rollbackTargetId: input.rollbackTargetId,
    })
    .returning();

  if (!deployment) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create forge deployment",
    });
  }

  return deployment;
}

export async function forgegraphUpdateDeploymentStatus(
  ctx: HandlerContext,
  input: {
    deploymentId: string;
    status: string;
  },
) {
  const [updated] = await ctx.db
    .update(forgeDeployments)
    .set({ status: input.status })
    .where(eq(forgeDeployments.id, input.deploymentId))
    .returning();

  // Emit activity event if the deployment is linked to a work item via its revision
  if (updated) {
    const revision = await ctx.db.query.forgeRevisions.findFirst({
      where: eq(forgeRevisions.id, updated.revisionId),
    });
    if (revision?.taskId) {
      await ctx.db.insert(activities).values({
        workItemId: revision.taskId,
        type: "deploy_status_changed",
        toValue: input.status,
        metadata: {
          deploymentId: input.deploymentId,
          environment: updated.environment,
          status: input.status,
        },
      });
    }
  }

  return updated;
}

export async function forgegraphIngestRunEvent(
  ctx: HandlerContext,
  input: {
    runId: string;
    repoId: string;
    revisionId: string;
    eventType: string;
    taskId?: string;
    agentId?: string;
    testStatus?: string;
    artifactRefs?: {
      type: string;
      url?: string;
      description?: string;
    }[];
  },
) {
  const [event] = await ctx.db
    .insert(forgeRunEvents)
    .values({
      runId: input.runId,
      repoId: input.repoId,
      revisionId: input.revisionId,
      eventType: input.eventType,
      taskId: input.taskId,
      agentId: input.agentId,
      testStatus: input.testStatus,
      artifactRefs: input.artifactRefs ?? [],
    })
    .returning();

  if (!event) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create forge run event",
    });
  }

  return event;
}

export async function forgegraphListDeployments(
  ctx: HandlerContext,
  input: {
    revisionId?: string;
    repoId?: string;
    environment?: string;
  },
) {
  const conditions = [];
  if (input.revisionId)
    conditions.push(eq(forgeDeployments.revisionId, input.revisionId));
  if (input.repoId)
    conditions.push(eq(forgeDeployments.repoId, input.repoId));
  if (input.environment)
    conditions.push(eq(forgeDeployments.environment, input.environment));

  return ctx.db.query.forgeDeployments.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(forgeDeployments.createdAt)],
  });
}

export async function forgegraphListBuilds(
  ctx: HandlerContext,
  input: {
    revisionId?: string;
  },
) {
  return ctx.db.query.forgeBuilds.findMany({
    where: input.revisionId
      ? eq(forgeBuilds.revisionId, input.revisionId)
      : undefined,
    orderBy: [desc(forgeBuilds.createdAt)],
  });
}

export async function forgegraphApproveProdDeploy(
  ctx: HandlerContext,
  input: { dispatchItemId: string },
) {
  // Verify item is in awaiting_prod_approval state
  const item = await ctx.db.query.dispatchItems.findFirst({
    where: eq(dispatchItems.id, input.dispatchItemId),
  });

  if (!item) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Dispatch item not found",
    });
  }

  if (item.pipelineState !== "awaiting_prod_approval") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Item is in state "${item.pipelineState}", expected "awaiting_prod_approval"`,
    });
  }

  // Find the build for this item (keyed by item.id)
  const build = await ctx.db.query.forgeBuilds.findFirst({
    where: eq(forgeBuilds.idempotencyKey, item.id),
  });

  if (!build) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No build found for this dispatch item",
    });
  }

  const revision = await ctx.db.query.forgeRevisions.findFirst({
    where: eq(forgeRevisions.id, build.revisionId),
  });

  if (!revision) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No revision found for this build",
    });
  }

  // Create prod deployment
  const [deployment] = await ctx.db
    .insert(forgeDeployments)
    .values({
      revisionId: revision.id,
      buildId: build.id,
      repoId: revision.repoId,
      environment: "prod",
      status: "deploying",
    })
    .returning();

  if (!deployment) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create prod deployment",
    });
  }

  // Set state to deploying_prod
  await ctx.db
    .update(dispatchItems)
    .set({ pipelineState: "deploying_prod" })
    .where(eq(dispatchItems.id, item.id));

  return deployment;
}

// ── ForgeGraph App Management ──────────────────────────────────────

export async function forgegraphListApps() {
  const fg = getForgeGraphClient();
  if (!fg) {
    return [];
  }
  try {
    return await fg.listApps();
  } catch {
    return [];
  }
}

export async function forgegraphListUnlinkedApps(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  const fg = getForgeGraphClient();
  if (!fg) return [];

  const [allApps, linkedProjects] = await Promise.all([
    fg.listApps().catch(() => []),
    ctx.db.query.projects.findMany({
      where: eq(projects.workspaceId, input.workspaceId),
      columns: { forgeGraphAppId: true },
    }),
  ]);

  const linkedIds = new Set(
    linkedProjects.map((p) => p.forgeGraphAppId).filter(Boolean),
  );

  return allApps.filter((app) => !linkedIds.has(app.id));
}

export async function forgegraphImportApp(
  ctx: HandlerContext,
  input: {
    workspaceId: string;
    appId: string;
    key: string;
  },
) {
  const fg = getForgeGraphClient();
  if (!fg) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ForgeGraph not configured",
    });
  }

  // ForgeGraph's /apps/:id endpoint uses slug, not id.
  // Look up from the full list instead to match by id.
  const allApps = await fg.listApps();
  const app = allApps.find((a) => a.id === input.appId);
  if (!app) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "ForgeGraph app not found",
    });
  }

  // Extract git URL from flakeRef (format: git+https://host/owner/repo.git?ref=main&rev=...)
  let remoteUrl: string | null = null;
  let remoteOwner: string | null = null;
  let remoteName: string | null = null;
  let mainBranch = "main";
  if (app.flakeRef) {
    const gitMatch = /git\+?(https?:\/\/[^?#]+)/.exec(app.flakeRef);
    const matchedUrl = gitMatch?.[1];
    if (matchedUrl) {
      remoteUrl = matchedUrl;
      const pathParts = new URL(remoteUrl).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        const [owner, name] = pathParts;
        if (owner && name) {
          remoteOwner = owner;
          remoteName = name;
        }
      }
    }
    const refMatch = /[?&]ref=([^&#]+)/.exec(app.flakeRef);
    if (refMatch?.[1]) mainBranch = refMatch[1];
  }

  const [project] = await ctx.db
    .insert(projects)
    .values({
      workspaceId: input.workspaceId,
      forgeGraphAppId: app.id,
      name: app.name,
      key: input.key,
      description: app.description,
      repoUrl: remoteUrl ?? app.flakeRef ?? null,
    })
    .returning();

  // Create a repository record so executeTask can find it
  if (remoteUrl && project) {
    await ctx.db.insert(repositories).values({
      userId: ctx.userId,
      planningProjectId: project.id,
      name: remoteName ?? app.name,
      path: `/repos/${app.slug}`,
      branch: mainBranch,
      mainBranch,
      remoteUrl,
      remoteProvider: "gitea",
      remoteOwner,
      remoteName,
    }).onConflictDoNothing();
  }

  return project;
}

export async function forgegraphImportAllApps(
  ctx: HandlerContext,
  input: { workspaceId: string },
) {
  const fg = getForgeGraphClient();
  if (!fg) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ForgeGraph not configured",
    });
  }

  const [allApps, linkedProjects] = await Promise.all([
    fg.listApps(),
    ctx.db.query.projects.findMany({
      where: eq(projects.workspaceId, input.workspaceId),
      columns: { forgeGraphAppId: true, key: true },
    }),
  ]);

  const linkedIds = new Set(
    linkedProjects.map((p) => p.forgeGraphAppId).filter(Boolean),
  );
  const existingKeys = new Set(
    linkedProjects.map((p) => p.key),
  );

  const unlinked = allApps.filter((app) => !linkedIds.has(app.id));
  if (unlinked.length === 0) return { imported: 0, projects: [] };

  const imported: typeof projects.$inferSelect[] = [];

  for (const app of unlinked) {
    let remoteUrl: string | null = null;
    let remoteOwner: string | null = null;
    let remoteName: string | null = null;
    let mainBranch = "main";
    if (app.flakeRef) {
      const gitMatch = /git\+?(https?:\/\/[^?#]+)/.exec(app.flakeRef);
      const matchedUrl = gitMatch?.[1];
      if (matchedUrl) {
        remoteUrl = matchedUrl;
        const pathParts = new URL(remoteUrl).pathname
          .replace(/\.git$/, "")
          .split("/")
          .filter(Boolean);
        if (pathParts.length >= 2) {
          const [owner, name] = pathParts;
          if (owner && name) {
            remoteOwner = owner;
            remoteName = name;
          }
        }
      }
      const refMatch = /[?&]ref=([^&#]+)/.exec(app.flakeRef);
      if (refMatch?.[1]) mainBranch = refMatch[1];
    }

    let key = deriveKeyFromName(app.name);
    let suffix = 1;
    while (existingKeys.has(key)) {
      key = deriveKeyFromName(app.name).slice(0, 14) + String(suffix++);
    }
    existingKeys.add(key);

    try {
      const [project] = await ctx.db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          forgeGraphAppId: app.id,
          name: app.name,
          key,
          description: app.description,
          repoUrl: remoteUrl ?? app.flakeRef ?? null,
        })
        .returning();

      if (remoteUrl && project) {
        await ctx.db
          .insert(repositories)
          .values({
            userId: ctx.userId,
            planningProjectId: project.id,
            name: remoteName ?? app.name,
            path: `/repos/${app.slug}`,
            branch: mainBranch,
            mainBranch,
            remoteUrl,
            remoteProvider: "gitea",
            remoteOwner,
            remoteName,
          })
          .onConflictDoNothing();
      }

      if (project) imported.push(project);
    } catch {
      // skip apps that fail (e.g. key collision)
    }
  }

  return { imported: imported.length, projects: imported };
}

function deriveKeyFromName(name: string): string {
  const key = name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 16);
  return key || "APP";
}
