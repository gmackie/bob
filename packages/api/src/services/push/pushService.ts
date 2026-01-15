import { and, eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import { devicePushTokens, user } from "@bob/db/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type NotificationType =
  | "task.blocked"
  | "task.completed"
  | "pr.ready"
  | "pr.merged"
  | "pr.needs_review"
  | "session.error";

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  categoryId?: string;
  priority?: "default" | "normal" | "high";
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  categoryId?: string;
  priority?: "default" | "normal" | "high";
  ttl?: number;
  expiration?: number;
}

export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?:
      | "DeviceNotRegistered"
      | "MessageTooBig"
      | "MessageRateExceeded"
      | "MismatchSenderId"
      | "InvalidCredentials";
  };
}

export interface SendResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: Array<{
    token: string;
    error: string;
    shouldRemoveToken: boolean;
  }>;
}

async function sendToExpo(
  messages: ExpoPushMessage[],
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) {
    return [];
  }

  const chunks: ExpoPushMessage[][] = [];
  const chunkSize = 100;
  for (let i = 0; i < messages.length; i += chunkSize) {
    chunks.push(messages.slice(i, i + chunkSize));
  }

  const allTickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Expo push API error (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as { data: ExpoPushTicket[] };
    allTickets.push(...result.data);
  }

  return allTickets;
}

async function getTokensForUser(userId: string): Promise<string[]> {
  const tokens = await db.query.devicePushTokens.findMany({
    where: and(
      eq(devicePushTokens.userId, userId),
      eq(devicePushTokens.enabled, true),
    ),
  });

  return tokens.map((t) => t.expoPushToken);
}

async function removeInvalidToken(token: string): Promise<void> {
  await db
    .delete(devicePushTokens)
    .where(eq(devicePushTokens.expoPushToken, token));
}

export async function sendPushNotification(
  userId: string,
  notification: PushNotificationPayload,
): Promise<SendResult> {
  const tokens = await getTokensForUser(userId);

  if (tokens.length === 0) {
    return {
      success: true,
      sent: 0,
      failed: 0,
      errors: [],
    };
  }

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: notification.sound ?? "default",
    badge: notification.badge,
    channelId: notification.channelId ?? "default",
    categoryId: notification.categoryId,
    priority: notification.priority ?? "high",
    ttl: 86400,
  }));

  const tickets = await sendToExpo(messages);

  const errors: SendResult["errors"] = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i]!;
    const token = tokens[i]!;

    if (ticket.status === "ok") {
      sent++;
    } else {
      failed++;
      const shouldRemove = ticket.details?.error === "DeviceNotRegistered";
      errors.push({
        token,
        error: ticket.message ?? ticket.details?.error ?? "Unknown error",
        shouldRemoveToken: shouldRemove,
      });

      if (shouldRemove) {
        await removeInvalidToken(token);
      }
    }
  }

  return {
    success: failed === 0,
    sent,
    failed,
    errors,
  };
}

export async function sendPushToMultipleUsers(
  userIds: string[],
  notification: PushNotificationPayload,
): Promise<Map<string, SendResult>> {
  const results = new Map<string, SendResult>();

  const sendPromises = userIds.map(async (userId) => {
    const result = await sendPushNotification(userId, notification);
    results.set(userId, result);
  });

  await Promise.all(sendPromises);

  return results;
}

export async function notifyTaskBlocked(
  userId: string,
  taskIdentifier: string,
  reason: string,
  sessionId?: string,
): Promise<SendResult> {
  return sendPushNotification(userId, {
    title: `Task ${taskIdentifier} Blocked`,
    body: reason.length > 100 ? `${reason.slice(0, 97)}...` : reason,
    data: {
      type: "task.blocked" as NotificationType,
      taskIdentifier,
      sessionId,
      deepLink: sessionId ? `bob://session/${sessionId}` : undefined,
    },
    channelId: "tasks",
    categoryId: "task_blocked",
    priority: "high",
  });
}

export async function notifyTaskCompleted(
  userId: string,
  taskIdentifier: string,
  prUrl?: string,
): Promise<SendResult> {
  return sendPushNotification(userId, {
    title: `Task ${taskIdentifier} Completed`,
    body: prUrl
      ? "Pull request is ready for review"
      : "Task has been completed",
    data: {
      type: "task.completed" as NotificationType,
      taskIdentifier,
      prUrl,
      deepLink: prUrl ? `bob://pr/${encodeURIComponent(prUrl)}` : undefined,
    },
    channelId: "tasks",
    priority: "default",
  });
}

export async function notifyPRReady(
  userId: string,
  prNumber: number,
  prTitle: string,
  prUrl: string,
  repositoryName: string,
): Promise<SendResult> {
  return sendPushNotification(userId, {
    title: "PR Ready for Review",
    body: `#${prNumber} ${prTitle} in ${repositoryName}`,
    data: {
      type: "pr.ready" as NotificationType,
      prNumber,
      prUrl,
      repositoryName,
      deepLink: `bob://pr/${encodeURIComponent(prUrl)}`,
    },
    channelId: "pull_requests",
    priority: "high",
  });
}

export async function notifyPRMerged(
  userId: string,
  prNumber: number,
  prTitle: string,
  repositoryName: string,
): Promise<SendResult> {
  return sendPushNotification(userId, {
    title: "PR Merged",
    body: `#${prNumber} ${prTitle} has been merged`,
    data: {
      type: "pr.merged" as NotificationType,
      prNumber,
      repositoryName,
    },
    channelId: "pull_requests",
    priority: "default",
  });
}

export async function notifySessionError(
  userId: string,
  sessionTitle: string,
  errorMessage: string,
  sessionId: string,
): Promise<SendResult> {
  return sendPushNotification(userId, {
    title: "Session Error",
    body: `${sessionTitle}: ${errorMessage.slice(0, 80)}`,
    data: {
      type: "session.error" as NotificationType,
      sessionId,
      deepLink: `bob://session/${sessionId}`,
    },
    channelId: "sessions",
    categoryId: "session_error",
    priority: "high",
  });
}

export interface RegisterTokenInput {
  userId: string;
  expoPushToken: string;
  deviceType: "ios" | "android" | "web";
  deviceName?: string;
}

export async function registerPushToken(
  input: RegisterTokenInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.query.devicePushTokens.findFirst({
    where: and(
      eq(devicePushTokens.userId, input.userId),
      eq(devicePushTokens.expoPushToken, input.expoPushToken),
    ),
  });

  if (existing) {
    await db
      .update(devicePushTokens)
      .set({
        enabled: true,
        lastSeenAt: new Date(),
        deviceName: input.deviceName ?? existing.deviceName,
      })
      .where(eq(devicePushTokens.id, existing.id));

    return { id: existing.id, created: false };
  }

  const [newToken] = await db
    .insert(devicePushTokens)
    .values({
      userId: input.userId,
      expoPushToken: input.expoPushToken,
      deviceType: input.deviceType,
      deviceName: input.deviceName,
      enabled: true,
      lastSeenAt: new Date(),
    })
    .returning();

  return { id: newToken!.id, created: true };
}

export async function unregisterPushToken(
  userId: string,
  expoPushToken: string,
): Promise<boolean> {
  const result = await db
    .delete(devicePushTokens)
    .where(
      and(
        eq(devicePushTokens.userId, userId),
        eq(devicePushTokens.expoPushToken, expoPushToken),
      ),
    )
    .returning();

  return result.length > 0;
}

export async function disablePushToken(
  userId: string,
  expoPushToken: string,
): Promise<boolean> {
  const result = await db
    .update(devicePushTokens)
    .set({ enabled: false })
    .where(
      and(
        eq(devicePushTokens.userId, userId),
        eq(devicePushTokens.expoPushToken, expoPushToken),
      ),
    )
    .returning();

  return result.length > 0;
}

export async function listUserTokens(userId: string): Promise<
  Array<{
    id: string;
    deviceType: string;
    deviceName: string | null;
    enabled: boolean;
    lastSeenAt: Date | null;
    createdAt: Date;
  }>
> {
  const tokens = await db.query.devicePushTokens.findMany({
    where: eq(devicePushTokens.userId, userId),
    orderBy: (t, { desc }) => [desc(t.lastSeenAt)],
  });

  return tokens.map((t) => ({
    id: t.id,
    deviceType: t.deviceType,
    deviceName: t.deviceName,
    enabled: t.enabled,
    lastSeenAt: t.lastSeenAt,
    createdAt: t.createdAt,
  }));
}

export async function updateTokenLastSeen(
  expoPushToken: string,
): Promise<void> {
  await db
    .update(devicePushTokens)
    .set({ lastSeenAt: new Date() })
    .where(eq(devicePushTokens.expoPushToken, expoPushToken));
}
