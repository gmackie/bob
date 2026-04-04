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
  updateWorkItemInputSchema,
} from "@bob/work-items/schema";
import { isForgeGraphEnabled, requireForgeGraphClient } from "../services/forgegraph/config";
import { resolveForgeGraphId, cacheMapping } from "../services/forgegraph/idResolver";
import type { FgWorkItem, FgArtifact, FgActivity } from "../services/forgegraph/forgeGraphClient";
import { toBobStatus } from "../services/forgegraph/statusMap";
import {
  apiKeyReadProcedure,
  apiKeyWriteProcedure,
  protectedProcedure,
} from "../trpc";

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

const buildListWorkItemsProcedure = (procedure: any) =>
  procedure.input(listWorkItemsInputSchema).query(async ({ ctx, input }: any) => {
    await assertWorkspaceAccess(ctx.db, ctx.session.user.id, input.workspaceId);

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
      new Set(items.map((item: any) => item.projectId).filter(Boolean)),
    ) as string[];
    const projectRows: any[] =
      projectIds.length > 0
        ? await ctx.db.query.projects.findMany({
            where: eq(projects.workspaceId, input.workspaceId),
          })
        : [];

    const projectById = new Map<string, any>(
      projectRows.map((project: any) => [project.id, project]),
    );

    return items.map((item: any) => {
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

const buildGetWorkItemProcedure = (procedure: any) =>
  procedure.input(getWorkItemInputSchema).query(async ({ ctx, input }: any) => {
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

const buildListCommentsProcedure = (procedure: any) =>
  procedure.input(listCommentsInputSchema).query(async ({ ctx, input }: any) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    return ctx.db.query.comments.findMany({
      where: eq(comments.workItemId, input.workItemId),
      orderBy: desc(comments.createdAt),
    });
  });

const buildCreateCommentProcedure = (procedure: any) =>
  procedure.input(createCommentInputSchema).mutation(async ({ ctx, input }: any) => {
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

const buildCreateArtifactProcedure = (procedure: any) =>
  procedure.input(createArtifactInputSchema).mutation(async ({ ctx, input }: any) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    const existingArtifacts: any[] = await ctx.db.query.workItemArtifacts.findMany({
      where: eq(workItemArtifacts.workItemId, input.workItemId),
    });

    const duplicateArtifact =
      input.producerId == null
        ? null
        : existingArtifacts.find(
            (artifact: any) =>
              artifact.producerType === input.producerType &&
              artifact.producerId === input.producerId,
          );

    if (duplicateArtifact) {
      return duplicateArtifact;
    }

    const currentArtifactsForRole = existingArtifacts.filter(
      (artifact: any) =>
        artifact.artifactRole === input.artifactRole && artifact.isCurrent,
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

const buildPromoteToTaskProcedure = (procedure: any) =>
  procedure.input(promoteToTaskInputSchema).mutation(async ({ ctx, input }: any) => {
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

    // Update local DB
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

const buildUpdateWorkItemProcedure = (procedure: any) =>
  procedure.input(updateWorkItemInputSchema).mutation(async ({ ctx, input }: any) => {
    const existing = await loadAccessibleWorkItem(
      ctx.db,
      ctx.session.user.id,
      input.id,
    );

    const updates = Object.fromEntries(
      Object.entries({
        title: input.title,
        description: input.description,
        status: input.status,
      }).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    const [workItem] = await ctx.db
      .update(workItems)
      .set(updates)
      .where(eq(workItems.id, input.id))
      .returning();

    const nextWorkItem = workItem ?? existing;

    const changedFields = ([
      {
        field: "title" as const,
        previousValue: existing.title ?? null,
        nextValue: input.title ?? null,
      },
      {
        field: "description" as const,
        previousValue: existing.description ?? null,
        nextValue: input.description ?? null,
      },
      {
        field: "status" as const,
        previousValue: existing.status ?? null,
        nextValue: input.status ?? null,
      },
    ] satisfies Array<{
      field: "title" | "description" | "status";
      previousValue: string | null;
      nextValue: string | null;
    }>).filter(
      (change) =>
        change.nextValue !== null && change.previousValue !== change.nextValue,
    );

    if (changedFields.length > 0) {
      await ctx.db.insert(activities).values(
        changedFields.map((change) => ({
          workItemId: input.id,
          userId: ctx.session.user.id,
          type: "status_changed",
          fromValue: change.previousValue,
          toValue: change.nextValue,
          metadata: { field: change.field },
        })),
      );
    }

    return nextWorkItem;
  });

const buildListActivitiesProcedure = (procedure: any) =>
  procedure.input(listActivitiesInputSchema).query(async ({ ctx, input }: any) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    // ── Local DB path ─────────────────────────────────────────────────
    return ctx.db.query.activities.findMany({
      where: eq(activities.workItemId, input.workItemId),
      orderBy: desc(activities.createdAt),
      limit: input.limit,
    });
  });

const buildListCurrentArtifactsProcedure = (procedure: any) =>
  procedure
    .input(listCurrentArtifactsInputSchema)
    .query(async ({ ctx, input }: any) => {
    await loadAccessibleWorkItem(ctx.db, ctx.session.user.id, input.workItemId);

    // ── Local DB path ─────────────────────────────────────────────────
      return ctx.db.query.workItemArtifacts.findMany({
      where: and(
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.isCurrent, true),
      ),
      orderBy: desc(workItemArtifacts.createdAt),
    });
  });

const buildListChildArtifactGroupsProcedure = (procedure: any) =>
  procedure
    .input(listChildArtifactGroupsInputSchema)
    .query(async ({ ctx, input }: any) => {
    await loadAccessibleWorkItem(
      ctx.db,
      ctx.session.user.id,
      input.parentWorkItemId,
    );

    // ── Local DB path ─────────────────────────────────────────────────
    const children: any[] = await ctx.db.query.workItems.findMany({
      where: eq(workItems.parentId, input.parentWorkItemId),
      orderBy: desc(workItems.updatedAt),
    });

    const groups = await Promise.all(
      children.map(async (child: any) => {
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

      return groups.filter((group: any) => group.artifacts.length > 0);
    });

const buildListNotificationsProcedure = (procedure: any) =>
  procedure
    .input(listNotificationsInputSchema)
    .query(async ({ ctx, input }: any) => {
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

const buildCreateNotificationProcedure = (procedure: any) =>
  procedure
    .input(createNotificationInputSchema)
    .mutation(async ({ ctx, input }: any) => {
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

const buildMarkNotificationAsReadProcedure = (procedure: any) =>
  procedure
    .input(markNotificationAsReadInputSchema)
    .mutation(async ({ ctx, input }: any) => {
    const [notification] = await ctx.db
      .update(notifications)
      .set({
        read: true,
        readAt: new Date().toISOString(),
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

const listWorkItemsProcedure = buildListWorkItemsProcedure(protectedProcedure);
const getWorkItemProcedure = buildGetWorkItemProcedure(protectedProcedure);
const updateWorkItemProcedure = buildUpdateWorkItemProcedure(protectedProcedure);
const listCommentsProcedure = buildListCommentsProcedure(protectedProcedure);
const createCommentProcedure = buildCreateCommentProcedure(protectedProcedure);
const createArtifactProcedure = buildCreateArtifactProcedure(protectedProcedure);
const promoteToTaskProcedure = buildPromoteToTaskProcedure(protectedProcedure);
const listActivitiesProcedure = buildListActivitiesProcedure(protectedProcedure);
const listCurrentArtifactsProcedure =
  buildListCurrentArtifactsProcedure(protectedProcedure);
const listChildArtifactGroupsProcedure =
  buildListChildArtifactGroupsProcedure(protectedProcedure);
const listNotificationsProcedure =
  buildListNotificationsProcedure(protectedProcedure);
const createNotificationProcedure =
  buildCreateNotificationProcedure(protectedProcedure);
const markNotificationAsReadProcedure =
  buildMarkNotificationAsReadProcedure(protectedProcedure);

const publicListWorkItemsProcedure =
  buildListWorkItemsProcedure(apiKeyReadProcedure);
const publicGetWorkItemProcedure =
  buildGetWorkItemProcedure(apiKeyReadProcedure);
const publicUpdateWorkItemProcedure =
  buildUpdateWorkItemProcedure(apiKeyWriteProcedure);
const publicListCommentsProcedure =
  buildListCommentsProcedure(apiKeyReadProcedure);
const publicCreateCommentProcedure =
  buildCreateCommentProcedure(apiKeyWriteProcedure);
const publicCreateArtifactProcedure =
  buildCreateArtifactProcedure(apiKeyWriteProcedure);
const publicPromoteToTaskProcedure =
  buildPromoteToTaskProcedure(apiKeyWriteProcedure);
const publicListActivitiesProcedure =
  buildListActivitiesProcedure(apiKeyReadProcedure);
const publicListCurrentArtifactsProcedure =
  buildListCurrentArtifactsProcedure(apiKeyReadProcedure);
const publicListChildArtifactGroupsProcedure =
  buildListChildArtifactGroupsProcedure(apiKeyReadProcedure);
const publicListNotificationsProcedure =
  buildListNotificationsProcedure(apiKeyReadProcedure);
const publicCreateNotificationProcedure =
  buildCreateNotificationProcedure(apiKeyWriteProcedure);
const publicMarkNotificationAsReadProcedure =
  buildMarkNotificationAsReadProcedure(apiKeyWriteProcedure);

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
  update: updateWorkItemProcedure,
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

export const publicWorkItemsRouter = {
  list: publicListWorkItemsProcedure,
  get: publicGetWorkItemProcedure,
  update: publicUpdateWorkItemProcedure,
  promoteToTask: publicPromoteToTaskProcedure,
  listComments: publicListCommentsProcedure,
  createComment: publicCreateCommentProcedure,
  createArtifact: publicCreateArtifactProcedure,
  listActivities: publicListActivitiesProcedure,
  listCurrentArtifacts: publicListCurrentArtifactsProcedure,
  listChildArtifactGroups: publicListChildArtifactGroupsProcedure,
  listNotifications: publicListNotificationsProcedure,
  createNotification: publicCreateNotificationProcedure,
  markNotificationAsRead: publicMarkNotificationAsReadProcedure,
};
