/**
 * In-app notification service — single write path for the user-facing inbox.
 *
 * Producers (comments, dispatch completion, public create API, etc.) should
 * call `createInAppNotification` rather than inserting into `notifications`
 * directly. That keeps inbox + optional Expo push consistent and makes the
 * push preference / token lookup a single place to change.
 *
 * Delivery model:
 *   - Inbox row is durable and is the source of truth for the web/mobile panel.
 *   - Push is best-effort: failures are logged and never fail the inbox write.
 *   - Session run-state transitions use the separate `notification_outbox`
 *     path in the ws-gateway (exactly-once send intent); this service is for
 *     product/inbox events, not the trust-slice outbox.
 */

import { and, eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { notifications, userPreferences } from "@bob/db/schema";
import type { WorkItemNotificationType } from "@bob/work-items/schema";

export interface CreateInAppNotificationInput {
  userId: string;
  workItemId?: string | null;
  actorId?: string | null;
  type: WorkItemNotificationType;
  title: string;
  body?: string | null;
  url?: string | null;
  /**
   * When true (default), also attempt an Expo push to the user's registered
   * devices, unless `userPreferences.pushNotifications` is false (absent row
   * defaults to true, matching the column default).
   */
  push?: boolean;
}

async function pushEnabledForUser(db: Db, userId: string): Promise<boolean> {
  const pref = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, userId),
    columns: { pushNotifications: true },
  });
  return pref?.pushNotifications ?? true;
}

export type InAppNotification = typeof notifications.$inferSelect;

export async function createInAppNotification(
  db: Db,
  input: CreateInAppNotificationInput,
): Promise<InAppNotification> {
  const [notification] = await db
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

  if (!notification) {
    throw new Error("Failed to create notification: insert returned no row");
  }

  if (input.push !== false) {
    try {
      if (await pushEnabledForUser(db, input.userId)) {
        const { sendPushNotification } = await import("../push/pushService.js");
        await sendPushNotification(input.userId, {
          title: input.title,
          body: input.body ?? input.title,
          data: {
            type: input.type,
            notificationId: notification.id,
            workItemId: input.workItemId ?? undefined,
            url: input.url ?? undefined,
          },
          channelId: "tasks",
          priority: "default",
        });
      }
    } catch (err) {
      // Inbox write already committed — never surface push failures to callers.
      console.error("[notifications] push failed:", err);
    }
  }

  return notification;
}

/**
 * Mark every unread, non-archived notification for `userId` as read.
 * Returns how many rows were updated.
 */
export async function markAllNotificationsAsRead(
  db: Db,
  userId: string,
): Promise<{ count: number }> {
  const updated = await db
    .update(notifications)
    .set({
      read: true,
      readAt: new Date().toISOString(),
    })
    .where(
      and(eq(notifications.userId, userId), eq(notifications.read, false)),
    )
    .returning({ id: notifications.id });

  return { count: updated.length };
}
