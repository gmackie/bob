import { z } from "zod/v4";
import { and, desc, eq, isNull } from "@bob/db";

import {
  activities,
  comments,
  notifications,
  projects,
  taskRuns,
  workItemArtifactProducerType,
  workItemArtifacts,
  workItemArtifactType,
  workItems,
  workItemNotificationType,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

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
  .input(
    z.object({
      workspaceId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      parentId: z.string().uuid().nullable().optional(),
      kind: z.enum(["issue", "epic", "task"]).optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    }),
  )
  .query(async ({ ctx, input }) => {
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

const getWorkItemProcedure = protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
    }),
  )
  .query(async ({ ctx, input }) => {
    const workItem = await ctx.db.query.workItems.findFirst({
      where: eq(workItems.id, input.id),
    });

    if (!workItem) {
      return null;
    }

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
  .input(
    z.object({
      workItemId: z.string().uuid(),
    }),
  )
  .query(({ ctx, input }) =>
    ctx.db.query.comments.findMany({
      where: eq(comments.workItemId, input.workItemId),
      orderBy: desc(comments.createdAt),
    }),
  );

const createCommentProcedure = protectedProcedure
  .input(
    z.object({
      workItemId: z.string().uuid(),
      body: z.string().min(1).max(10000),
      bodyHtml: z.string().optional(),
      parentId: z.string().uuid().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
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
  .input(
    z.object({
      workItemId: z.string().uuid(),
      taskRunId: z.string().uuid().optional(),
      producerType: z.enum(workItemArtifactProducerType),
      producerId: z.string().optional(),
      artifactType: z.enum(workItemArtifactType),
      artifactRole: z.string().min(1),
      url: z.string().url(),
      title: z.string().optional(),
      summary: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
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
        producerType: input.producerType,
        producerId: input.producerId ?? null,
        artifactType: input.artifactType,
        artifactRole: input.artifactRole,
        url: input.url,
        title: input.title ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
        isCurrent: true,
      })
      .returning();

    return artifact;
  });

const listCurrentArtifactsProcedure = protectedProcedure
  .input(
    z.object({
      workItemId: z.string().uuid(),
    }),
  )
  .query(({ ctx, input }) =>
    ctx.db.query.workItemArtifacts.findMany({
      where: and(
        eq(workItemArtifacts.workItemId, input.workItemId),
        eq(workItemArtifacts.isCurrent, true),
      ),
      orderBy: desc(workItemArtifacts.createdAt),
    }),
  );

const listChildArtifactGroupsProcedure = protectedProcedure
  .input(
    z.object({
      parentWorkItemId: z.string().uuid(),
    }),
  )
  .query(async ({ ctx, input }) => {
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
  .input(
    z.object({
      unreadOnly: z.boolean().default(false),
      limit: z.number().min(1).max(100).default(50),
    }),
  )
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
  .input(
    z.object({
      userId: z.string(),
      workItemId: z.string().uuid().optional(),
      actorId: z.string().optional(),
      type: z.enum(workItemNotificationType),
      title: z.string().min(1).max(256),
      body: z.string().optional(),
      url: z.string().url().optional(),
    }),
  )
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
  .input(
    z.object({
      id: z.string().uuid(),
    }),
  )
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
};

export const taskRunRouter = {
  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const runs = await ctx.db.query.taskRuns.findMany({
        where: and(
          eq(taskRuns.userId, ctx.session.user.id),
          eq(taskRuns.kanbangerIssueId, input.workItemId),
        ),
        orderBy: desc(taskRuns.createdAt),
      });

      return runs.map((run) => ({
        ...run,
        workItemId: run.kanbangerIssueId,
        workItemIdentifier: run.kanbangerIssueIdentifier,
      }));
    }),
};

export const workItemsRouter = {
  list: listWorkItemsProcedure,
  get: getWorkItemProcedure,
  listComments: listCommentsProcedure,
  createComment: createCommentProcedure,
  createArtifact: createArtifactProcedure,
  listCurrentArtifacts: listCurrentArtifactsProcedure,
  listChildArtifactGroups: listChildArtifactGroupsProcedure,
  listNotifications: listNotificationsProcedure,
  createNotification: createNotificationProcedure,
  markNotificationAsRead: markNotificationAsReadProcedure,
};
