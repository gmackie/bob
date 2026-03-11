import { z } from "zod";
import { eq, and, desc, isNull, count } from "drizzle-orm";
import { notifications, users, issues } from "@linear-clone/db";
import { router, protectedProcedure } from "../trpc";

const notificationTypeEnum = z.enum([
  "issue_assigned",
  "issue_mentioned",
  "issue_commented",
  "issue_status_changed",
  "project_update",
  "cycle_started",
  "cycle_ended",
]);

export const notificationRouter = router({
  // List notifications for current user
  list: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) return { notifications: [], unreadCount: 0 };

      const conditions = [eq(notifications.userId, user.id), isNull(notifications.archivedAt)];

      if (input.unreadOnly) {
        conditions.push(eq(notifications.read, false));
      }

      const result = await ctx.db
        .select({
          notification: notifications,
          actor: {
            id: users.id,
            name: users.name,
            email: users.email,
            avatarUrl: users.avatarUrl,
          },
          issue: {
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
          },
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorId, users.id))
        .leftJoin(issues, eq(notifications.issueId, issues.id))
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get unread count
      const [unreadResult] = await ctx.db
        .select({ count: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, user.id),
            eq(notifications.read, false),
            isNull(notifications.archivedAt)
          )
        );

      return {
        notifications: result.map((r) => ({
          ...r.notification,
          actor: r.actor,
          issue: r.issue,
        })),
        unreadCount: unreadResult?.count ?? 0,
      };
    }),

  // Get unread notification count
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) return 0;

    const [result] = await ctx.db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.read, false),
          isNull(notifications.archivedAt)
        )
      );

    return result?.count ?? 0;
  }),

  // Mark notification as read
  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [notification] = await ctx.db
        .update(notifications)
        .set({ read: true, readAt: new Date() })
        .where(eq(notifications.id, input.id))
        .returning();

      return notification;
    }),

  // Mark all notifications as read
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) return { success: false };

    await ctx.db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));

    return { success: true };
  }),

  // Archive notification
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [notification] = await ctx.db
        .update(notifications)
        .set({ archivedAt: new Date() })
        .where(eq(notifications.id, input.id))
        .returning();

      return notification;
    }),

  // Archive all read notifications
  archiveAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) return { success: false };

    await ctx.db
      .update(notifications)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.read, true),
          isNull(notifications.archivedAt)
        )
      );

    return { success: true };
  }),

  // Create notification (internal use)
  create: protectedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        type: notificationTypeEnum,
        issueId: z.string().uuid().optional(),
        actorId: z.string().uuid().optional(),
        title: z.string(),
        body: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [notification] = await ctx.db.insert(notifications).values(input).returning();

      return notification;
    }),

  // Bulk create notifications (for mentions, etc.)
  bulkCreate: protectedProcedure
    .input(
      z.object({
        userIds: z.array(z.string().uuid()),
        type: notificationTypeEnum,
        issueId: z.string().uuid().optional(),
        actorId: z.string().uuid().optional(),
        title: z.string(),
        body: z.string().optional(),
        url: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userIds, ...notificationData } = input;

      const result = await ctx.db
        .insert(notifications)
        .values(userIds.map((userId) => ({ userId, ...notificationData })))
        .returning();

      return result;
    }),

  // Delete notification
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(notifications).where(eq(notifications.id, input.id));
      return { success: true };
    }),
});
