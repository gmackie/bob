import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { and, desc, eq, isNull, or } from "@bob/db";

import {
  activities,
  comments,
  notifications,
  projects,
  runLifecycleEvents,
  taskRuns,
  workItemArtifacts,
  workItems,
  workspaceMembers,
} from "@bob/db/schema";

import {
  createArtifactInputSchema,
  createCommentInputSchema,
  createNotificationInputSchema,
  getWorkItemInputSchema,
  listActivitiesInputSchema,
  listChildArtifactGroupsInputSchema,
  listCommentsInputSchema,
  listCurrentArtifactsInputSchema,
  listNotificationsInputSchema,
  listWorkItemsInputSchema,
  markNotificationAsReadInputSchema,
  promoteToTaskInputSchema,
} from "../contracts/work-items-rest";
import { isForgeGraphEnabled, requireForgeGraphClient } from "../services/forgegraph/config";
import { resolveForgeGraphId, cacheMapping } from "../services/forgegraph/idResolver";
import type { FgWorkItem, FgArtifact, FgActivity } from "../services/forgegraph/forgeGraphClient";
import { toBobStatus } from "../services/forgegraph/statusMap";
import { protectedProcedure } from "../trpc";

async function assertWorkspaceAccess(db: any, userId: string, workspaceId: string) {
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

async function assertWorkItemAccess(db: any, userId: string, workItem: { workspaceId: string | null | undefined }) {
  if (!workItem.workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkspaceAccess(db, userId, workItem.workspaceId);
}

async function loadAccessibleWorkItem(db: any, userId: string, workItemId: string) {
  const workItem = await db.query.workItems.findFirst({
    where: eq(workItems.id, workItemId),
  });

  if (!workItem) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await assertWorkItemAccess(db, userId, workItem);
  return workItem;
}

/** Map a ForgeGraph work item to Bob's local shape. */
function mapFgWorkItemToLocal(
  fg: FgWorkItem,
  project?: { id: string; key: string; name: string } | null,
) {
  const meta = fg.metadata as { projectKey?: string; sequenceNumber?: number } | null;
  const identifier =
    meta?.projectKey && meta?.sequenceNumber
      ? `${meta.projectKey}-${meta.sequenceNumber}`
      : fg.externalId?.slice(0, 8).toUpperCase() ?? fg.id.slice(0, 8).toUpperCase();

  return {
    id: fg.externalId ?? fg.id,
    identifier,
    title: fg.title,
    description: fg.description ?? null,
    kind: fg.kind,
    status: (fg.metadata as any)?.bobStatus ?? toBobStatus(fg.status),
    priority: (fg.metadata as any)?.priority ?? "no_priority",
    sequenceNumber: meta?.sequenceNumber ?? 0,
    projectId: fg.repositoryId ?? null,
    project: project ?? null,
    createdAt: new Date(fg.createdAt),
    updatedAt: new Date(fg.updatedAt),
  };
}

/** Map a ForgeGraph artifact to Bob's local artifact shape. */
function mapFgArtifactToLocal(fg: FgArtifact) {
  return {
    id: fg.id,
    workItemId: fg.workItemId,
    taskRunId: null,
    sessionId: null,
    producerType: fg.producerType,
    producerId: fg.producerId ?? null,
    artifactType: fg.artifactType,
    artifactRole: fg.artifactRole,
    title: fg.title ?? null,
    summary: fg.summary ?? null,
    content: fg.content ?? null,
    url: fg.url ?? null,
    isCurrent: fg.isCurrent,
    metadata: fg.metadata ?? null,
    createdAt: new Date(fg.createdAt),
  };
}

/** Map a ForgeGraph activity to Bob's local activity shape. */
function mapFgActivityToLocal(fg: FgActivity) {
  return {
    id: fg.id,
    workItemId: fg.workItemId,
    userId: fg.actorId,
    type: fg.type,
    fromValue: null,
    toValue: null,
    metadata: fg.metadata ?? null,
    createdAt: new Date(fg.createdAt),
  };
}

function formatWorkItemIdentifier(input: {
  projectKey: string | null;
  sequenceNumber: number | null | undefined;
  id: string;
}): string {
  if (input.projectKey && input.sequenceNumber && input.sequenceNumber > 0) {
    return `${input.projectKey}-${input.sequenceNumber}`;
  }

  const suffix = input.id.slice(0, 8).toUpperCase();
  return input.projectKey ? `${input.projectKey}-${suffix}` : `TASK-${suffix}`;
}

const listWorkItemsProcedure = protectedProcedure
  .input(listWorkItemsInputSchema)
  .query(async ({ ctx, input }) => {
    await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

    // ── ForgeGraph read path ──────────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();

      // Build FG filters
      const fgFilters: Record<string, string | number> = {};
      if (input.projectId) fgFilters.repositoryId = input.projectId;
      if (input.parentId) fgFilters.parentId = input.parentId;
      if (input.kind) fgFilters.kind = input.kind;
      if (input.status) fgFilters.status = input.status;
      fgFilters.limit = input.limit;

      const fgItems = await fg.listWorkItems(fgFilters);

      // Load projects locally for enrichment
      const projectRows = await ctx.db.query.projects.findMany({
        where: eq(projects.workspaceId, input.workspaceId),
      });
      const projectById = new Map(projectRows.map((p) => [p.id, p]));

      return fgItems.map((fgItem) => {
        // Cache the mapping for future lookups
        if (fgItem.externalId) cacheMapping(fgItem.externalId, fgItem.id);

        const project = fgItem.repositoryId
          ? projectById.get(fgItem.repositoryId) ?? null
          : null;
        const mapped = mapFgWorkItemToLocal(fgItem, project ? { id: project.id, key: project.key, name: project.name } : null);

        return {
          ...mapped,
          // Spread extra fields the UI might expect from the local DB shape
          ownerUserId: null,
          workspaceId: input.workspaceId,
          parentId: fgItem.parentId ?? null,
          project,
        };
      });
    }

    // ── Local DB path ─────────────────────────────────────────────────
    const items = await ctx.db.query.workItems.findMany({
      where: and(
        eq(workItems.workspaceId, input.workspaceId),
        input.projectId ? eq(workItems.projectId, input.projectId) : undefined,
        input.parentId === null
          ? isNull(workItems.parentId)
          : input.parentId
            ? eq(workItems.parentId, input.parentId)
            : undefined,
        input.kind ? eq(workItems.kind, input.kind) : undefined,
        input.status ? eq(workItems.status, input.status) : undefined,
      ),
      orderBy: desc(workItems.updatedAt),
      limit: input.limit,
    });

    const projectIds = Array.from(
      new Set(items.map((item) => item.projectId).filter(Boolean)),
    ) as string[];
    const projectRows =
      projectIds.length > 0
        ? await ctx.db.query.projects.findMany({
            where: eq(projects.workspaceId, input.workspaceId),
          })
        : [];

    const projectById = new Map(projectRows.map((project) => [project.id, project]));

    return items.map((item) => {
      const project = item.projectId ? projectById.get(item.projectId) ?? null : null;

      return {
        ...item,
        identifier: formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: item.sequenceNumber,
          id: item.id,
        }),
        project,
      };
    });
  });

/** Parse a short identifier like "BOB-27" into { projectKey, sequenceNumber }. */
function parseIdentifier(id: string): { projectKey: string; sequenceNumber: number } | null {
  const match = id.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
  if (!match) return null;
  return { projectKey: match[1]!.toUpperCase(), sequenceNumber: parseInt(match[2]!, 10) };
}

const getWorkItemProcedure = protectedProcedure
  .input(getWorkItemInputSchema)
  .query(async ({ ctx, input }) => {
    // ── ForgeGraph read path ──────────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id);

      let fgItem: FgWorkItem | null = null;
      let project: { id: string; key: string; name: string } | null = null;

      if (isUuid) {
        // Resolve Bob UUID → FG ID, then fetch detail
        const fgId = await resolveForgeGraphId(fg, input.id);
        if (fgId) {
          try {
            fgItem = await fg.getWorkItem(fgId);
          } catch {
            fgItem = null;
          }
        }
      } else {
        // Parse short identifier like "BOB-27"
        const parsed = parseIdentifier(input.id);
        if (parsed) {
          const localProject = await ctx.db.query.projects.findFirst({
            where: eq(projects.key, parsed.projectKey),
          });
          if (localProject) {
            project = { id: localProject.id, key: localProject.key, name: localProject.name };
            // Search FG by repositoryId + metadata
            try {
              const candidates = await fg.listWorkItems({ repositoryId: localProject.id });
              fgItem = candidates.find((c) => {
                const meta = c.metadata as { projectKey?: string; sequenceNumber?: number } | null;
                return meta?.projectKey === parsed.projectKey && meta?.sequenceNumber === parsed.sequenceNumber;
              }) ?? null;
            } catch {
              fgItem = null;
            }
          }
        }
      }

      if (!fgItem) {
        return null;
      }

      // Cache the mapping
      if (fgItem.externalId) cacheMapping(fgItem.externalId, fgItem.id);

      // Resolve project if not already resolved
      if (!project && fgItem.repositoryId) {
        const localProject = await ctx.db.query.projects.findFirst({
          where: eq(projects.id, fgItem.repositoryId),
        });
        if (localProject) {
          project = { id: localProject.id, key: localProject.key, name: localProject.name };
        }
      }

      const mapped = mapFgWorkItemToLocal(fgItem, project);

      // Detail endpoint returns children and artifacts inline
      const currentArtifacts = (fgItem.artifacts ?? [])
        .filter((a) => a.isCurrent)
        .map(mapFgArtifactToLocal);

      const childCount = fgItem.children?.length ?? 0;

      return {
        workItem: {
          ...mapped,
          ownerUserId: null,
          workspaceId: null,
          parentId: fgItem.parentId ?? null,
          project,
        },
        currentArtifacts,
        childCount,
      };
    }

    // ── Local DB path ─────────────────────────────────────────────────
    // Try UUID lookup first
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id);

    let workItem;
    if (isUuid) {
      workItem = await ctx.db.query.workItems.findFirst({
        where: eq(workItems.id, input.id),
      });
    } else {
      // Try short identifier lookup (e.g. "BOB-27")
      const parsed = parseIdentifier(input.id);
      if (parsed) {
        const project = await ctx.db.query.projects.findFirst({
          where: eq(projects.key, parsed.projectKey),
        });
        if (project) {
          workItem = await ctx.db.query.workItems.findFirst({
            where: and(
              eq(workItems.projectId, project.id),
              eq(workItems.sequenceNumber, parsed.sequenceNumber),
            ),
          });
        }
      }
    }

    if (!workItem) {
      return null;
    }

    await assertWorkItemAccess(ctx.db, ctx.session.user.id, workItem);

    const [project, currentArtifacts, children] = await Promise.all([
      workItem.projectId
        ? ctx.db.query.projects.findFirst({
            where: eq(projects.id, workItem.projectId),
          })
        : Promise.resolve(null),
      ctx.db.query.workItemArtifacts.findMany({
        where: and(
          eq(workItemArtifacts.workItemId, workItem.id),
          eq(workItemArtifacts.isCurrent, true),
        ),
        orderBy: desc(workItemArtifacts.createdAt),
      }),
      ctx.db.query.workItems.findMany({
        where: eq(workItems.parentId, workItem.id),
      }),
    ]);

    return {
      workItem: {
        ...workItem,
        identifier: formatWorkItemIdentifier({
          projectKey: project?.key ?? null,
          sequenceNumber: workItem.sequenceNumber,
          id: workItem.id,
        }),
        project,
      },
      currentArtifacts,
      childCount: children.length,
    };
  });

const listCommentsProcedure = protectedProcedure
  .input(listCommentsInputSchema)
  .query(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    return ctx.db.query.comments.findMany({
      where: eq(comments.workItemId, input.workItemId),
      orderBy: desc(comments.createdAt),
    });
  });

const createCommentProcedure = protectedProcedure
  .input(createCommentInputSchema)
  .mutation(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    const [comment] = await ctx.db
      .insert(comments)
      .values({
        workItemId: input.workItemId,
        userId: ctx.session.user.id,
        parentId: input.parentId ?? null,
        body: input.body,
        bodyHtml: input.bodyHtml ?? null,
      })
      .returning();

    await ctx.db
      .insert(activities)
      .values({
        workItemId: input.workItemId,
        userId: ctx.session.user.id,
        type: "comment_added",
        metadata: { commentId: comment?.id ?? null },
      })
      .returning();

    return comment;
  });

const createArtifactProcedure = protectedProcedure
  .input(createArtifactInputSchema)
  .mutation(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    const existingArtifacts = await ctx.db.query.workItemArtifacts.findMany({
      where: eq(workItemArtifacts.workItemId, input.workItemId),
    });

    const duplicateArtifact =
      input.producerId == null
        ? null
        : existingArtifacts.find(
            (artifact) =>
              artifact.producerType === input.producerType &&
              artifact.producerId === input.producerId,
          );

    if (duplicateArtifact) {
      return duplicateArtifact;
    }

    const currentArtifactsForRole = existingArtifacts.filter(
      (artifact) => artifact.artifactRole === input.artifactRole && artifact.isCurrent,
    );

    if (currentArtifactsForRole.length > 0) {
      await ctx.db
        .update(workItemArtifacts)
        .set({ isCurrent: false })
        .where(
          and(
            eq(workItemArtifacts.workItemId, input.workItemId),
            eq(workItemArtifacts.artifactRole, input.artifactRole),
            eq(workItemArtifacts.isCurrent, true),
          ),
        )
        .returning();
    }

    const [artifact] = await ctx.db
      .insert(workItemArtifacts)
      .values({
        workItemId: input.workItemId,
        taskRunId: input.taskRunId ?? null,
        sessionId: input.sessionId ?? null,
        producerType: input.producerType,
        producerId: input.producerId ?? null,
        artifactType: input.artifactType,
        artifactRole: input.artifactRole,
        url: input.url ?? null,
        title: input.title ?? null,
        summary: input.summary ?? null,
        content: input.content ?? null,
        metadata: input.metadata ?? null,
        isCurrent: true,
      })
      .returning();

    return artifact;
  });

const promoteToTaskProcedure = protectedProcedure
  .input(promoteToTaskInputSchema)
  .mutation(async ({ ctx, input }) => {
    const existing = await loadAccessibleWorkItem(
      ctx.db,
      ctx.session.user.id,
      input.id,
    );

    if (!existing) {
      return null;
    }

    if (existing.kind === "task") {
      return existing;
    }

    // ── ForgeGraph write path ──────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();
      const fgId = await resolveForgeGraphId(fg, input.id);
      if (fgId) {
        await fg.updateWorkItem(fgId, { kind: "task" });
      }
    }

    // Always update local DB (ForgeGraph is supplementary)
    const [workItem] = await ctx.db
      .update(workItems)
      .set({
        kind: "task",
      })
      .where(eq(workItems.id, input.id))
      .returning();

    await ctx.db
      .insert(activities)
      .values({
        workItemId: input.id,
        userId: ctx.session.user.id,
        type: "status_changed",
        fromValue: existing.kind,
        toValue: "task",
        metadata: {
          field: "kind",
        },
      })
      .returning();

    return workItem ?? existing;
  });

const listActivitiesProcedure = protectedProcedure
  .input(listActivitiesInputSchema)
  .query(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    // ── ForgeGraph read path ──────────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();
      const fgId = await resolveForgeGraphId(fg, input.workItemId);
      if (fgId) {
        const fgActivities = await fg.listActivities(fgId, input.limit);
        return fgActivities.map(mapFgActivityToLocal);
      }
    }

    // ── Local DB path ─────────────────────────────────────────────────
    return ctx.db.query.activities.findMany({
      where: eq(activities.workItemId, input.workItemId),
      orderBy: desc(activities.createdAt),
      limit: input.limit,
    });
  });

const listCurrentArtifactsProcedure = protectedProcedure
  .input(listCurrentArtifactsInputSchema)
  .query(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    // ── ForgeGraph read path ──────────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();
      const fgId = await resolveForgeGraphId(fg, input.workItemId);
      if (fgId) {
        const fgArtifacts = await fg.listArtifacts(fgId);
        return fgArtifacts.filter((a) => a.isCurrent).map(mapFgArtifactToLocal);
      }
    }

    // ── Local DB path ─────────────────────────────────────────────────
    return ctx.db.query.workItemArtifacts.findMany({
      where: and(
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.isCurrent, true),
      ),
      orderBy: desc(workItemArtifacts.createdAt),
    });
  });

const listChildArtifactGroupsProcedure = protectedProcedure
  .input(listChildArtifactGroupsInputSchema)
  .query(async ({ ctx, input }) => {
    await loadAccessibleWorkItem(
      ctx.db,
      ctx.session.user.id,
      input.parentWorkItemId,
    );

    // ── ForgeGraph read path ──────────────────────────────────────────
    if (isForgeGraphEnabled()) {
      const fg = requireForgeGraphClient();
      const fgId = await resolveForgeGraphId(fg, input.parentWorkItemId);
      if (fgId) {
        // Detail endpoint includes children inline
        const parentDetail = await fg.getWorkItem(fgId);
        const fgChildren = parentDetail.children ?? [];

        const groups = await Promise.all(
          fgChildren.map(async (child) => {
            // Cache mapping for each child
            if (child.externalId) cacheMapping(child.externalId, child.id);

            // If child has artifacts inline, use them; otherwise fetch
            let childArtifacts = child.artifacts;
            if (!childArtifacts) {
              childArtifacts = await fg.listArtifacts(child.id);
            }

            const currentArtifacts = childArtifacts
              .filter((a) => a.isCurrent)
              .map(mapFgArtifactToLocal);

            return {
              workItem: mapFgWorkItemToLocal(child),
              artifacts: currentArtifacts,
            };
          }),
        );

        return groups.filter((group) => group.artifacts.length > 0);
      }
    }

    // ── Local DB path ─────────────────────────────────────────────────
    const children = await ctx.db.query.workItems.findMany({
      where: eq(workItems.parentId, input.parentWorkItemId),
      orderBy: desc(workItems.updatedAt),
    });

    const groups = await Promise.all(
      children.map(async (child) => {
        const artifacts = await ctx.db.query.workItemArtifacts.findMany({
          where: and(
            eq(workItemArtifacts.workItemId, child.id),
            eq(workItemArtifacts.isCurrent, true),
          ),
          orderBy: desc(workItemArtifacts.createdAt),
        });

        return {
          workItem: child,
          artifacts,
        };
      }),
    );

    return groups.filter((group) => group.artifacts.length > 0);
  });

const listNotificationsProcedure = protectedProcedure
  .input(listNotificationsInputSchema)
  .query(async ({ ctx, input }) => {
    const filters = [
      eq(notifications.userId, ctx.session.user.id),
      isNull(notifications.archivedAt),
    ];

    if (input.unreadOnly) {
      filters.push(eq(notifications.read, false));
    }

    const items = await ctx.db.query.notifications.findMany({
      where: and(...filters),
      orderBy: desc(notifications.createdAt),
      limit: input.limit,
    });

    return { items };
  });

const createNotificationProcedure = protectedProcedure
  .input(createNotificationInputSchema)
  .mutation(async ({ ctx, input }) => {
    const [notification] = await ctx.db
      .insert(notifications)
      .values({
        userId: input.userId,
        workItemId: input.workItemId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
      })
      .returning();

    return notification;
  });

const markNotificationAsReadProcedure = protectedProcedure
  .input(markNotificationAsReadInputSchema)
  .mutation(async ({ ctx, input }) => {
    const [notification] = await ctx.db
      .update(notifications)
      .set({
        read: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, input.id),
          eq(notifications.userId, ctx.session.user.id),
        ),
      )
      .returning();

    return notification;
  });

export const workItemRouter = {
  list: listWorkItemsProcedure,
  get: getWorkItemProcedure,
  promoteToTask: promoteToTaskProcedure,
};

export const commentRouter = {
  listByWorkItem: listCommentsProcedure,
  create: createCommentProcedure,
};

export const artifactRouter = {
  create: createArtifactProcedure,
  listCurrentByWorkItem: listCurrentArtifactsProcedure,
  listChildGroups: listChildArtifactGroupsProcedure,
};

export const notificationRouter = {
  list: listNotificationsProcedure,
  create: createNotificationProcedure,
  markAsRead: markNotificationAsReadProcedure,

  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        platform: z.enum(["ios", "android", "web"]),
        deviceName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { registerPushToken } = await import(
        "../services/push/pushService"
      );
      return registerPushToken({
        userId: ctx.session.user.id,
        expoPushToken: input.token,
        deviceType: input.platform,
        deviceName: input.deviceName,
      });
    }),
};

export const taskRunRouter = {
  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

      const runs = await ctx.db.query.taskRuns.findMany({
        where: and(
          eq(taskRuns.userId, ctx.session.user.id),
          or(
            eq(taskRuns.workItemId, input.workItemId),
            eq(taskRuns.planningItemId, input.workItemId),
          ),
        ),
        orderBy: desc(taskRuns.createdAt),
      });

      return runs.map((run) => ({
        ...run,
        workItemId: run.workItemId ?? run.planningItemId,
        workItemIdentifier:
          run.workItemIdentifierSnapshot ?? run.planningItemIdentifier,
      }));
    }),

  execute: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        agentType: z.string().default("claude"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workItem = await loadAccessibleWorkItem(
        ctx.db,
        ctx.session.user.id,
        input.workItemId,
      );

      const project = workItem.projectId
        ? await ctx.db.query.projects.findFirst({
            where: eq(projects.id, workItem.projectId),
          })
        : null;

      const identifier = formatWorkItemIdentifier({
        projectKey: project?.key ?? null,
        sequenceNumber: workItem.sequenceNumber,
        id: workItem.id,
      });

      const { executeTask } = await import(
        "@bob/execution/runtime/taskExecutor"
      );

      const result = await executeTask(
        ctx.session.user.id,
        {
          id: workItem.id,
          identifier,
          title: workItem.title,
          description: workItem.description,
          workspaceId: workItem.workspaceId ?? "",
          projectId: workItem.projectId ?? "",
          assigneeId: null,
          labels: [],
          priority: 0,
        },
        {
          agentType: input.agentType,
        },
      );

      return result;
    }),

  listLifecycleEvents: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

      const events = await ctx.db
        .select({
          id: runLifecycleEvents.id,
          taskRunId: runLifecycleEvents.taskRunId,
          eventType: runLifecycleEvents.eventType,
          phase: runLifecycleEvents.phase,
          metadata: runLifecycleEvents.metadata,
          createdAt: runLifecycleEvents.createdAt,
        })
        .from(runLifecycleEvents)
        .where(eq(runLifecycleEvents.workItemId, input.workItemId))
        .orderBy(desc(runLifecycleEvents.createdAt))
        .limit(input.limit);

      return events;
    }),
};

const listRecentActivitiesProcedure = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(50),
    }),
  )
  .query(async ({ ctx, input }) => {
    const recentActivities = await ctx.db.query.activities.findMany({
      orderBy: desc(activities.createdAt),
      limit: input.limit,
      with: {
        workItem: {
          columns: {
            id: true,
            title: true,
            projectId: true,
            sequenceNumber: true,
          },
          with: {
            project: {
              columns: {
                id: true,
                key: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return recentActivities.map((activity) => ({
      ...activity,
      workItemTitle: activity.workItem?.title ?? null,
      workItemIdentifier: activity.workItem
        ? formatWorkItemIdentifier({
            projectKey: activity.workItem.project?.key ?? null,
            sequenceNumber: activity.workItem.sequenceNumber,
            id: activity.workItem.id,
          })
        : null,
    }));
  });

export const activityRouter = {
  listByWorkItem: listActivitiesProcedure,
  listRecent: listRecentActivitiesProcedure,
};

export const workItemsRouter = {
  list: listWorkItemsProcedure,
  get: getWorkItemProcedure,
  promoteToTask: promoteToTaskProcedure,
  listComments: listCommentsProcedure,
  createComment: createCommentProcedure,
  createArtifact: createArtifactProcedure,
  listActivities: listActivitiesProcedure,
  listCurrentArtifacts: listCurrentArtifactsProcedure,
  listChildArtifactGroups: listChildArtifactGroupsProcedure,
  listNotifications: listNotificationsProcedure,
  createNotification: createNotificationProcedure,
  markNotificationAsRead: markNotificationAsReadProcedure,
};
