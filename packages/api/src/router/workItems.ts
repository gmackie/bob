import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";
import { and, desc, eq, isNull } from "@bob/db";

import {
  activities,
  comments,
  notifications,
  workItemArtifactProducerType,
  workItemArtifacts,
  workItemArtifactType,
  workItems,
  workItemNotificationType,
} from "@bob/db/schema";

import { protectedProcedure } from "../trpc";

export const workItemsRouter: TRPCRouterRecord = {
  listComments: protectedProcedure
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
    ),

  createComment: protectedProcedure
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
    }),

  createArtifact: protectedProcedure
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
        (artifact) =>
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
    }),

  listCurrentArtifacts: protectedProcedure
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
    ),

  listChildArtifactGroups: protectedProcedure
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
    }),

  listNotifications: protectedProcedure
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
    }),

  createNotification: protectedProcedure
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
    }),

  markNotificationAsRead: protectedProcedure
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
    }),
};
