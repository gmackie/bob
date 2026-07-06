// Expo push notifications for terminal session events.
//
// The gateway is the process that receives terminal session_status from the
// daemon, so it's the natural place to fire "your task finished" pushes. It's
// a slim relay (deps: @bob/db, @bob/ws only), so rather than pull in the full
// @bob/api push service we inline the minimal Expo send here. Keep the payload
// shape in sync with packages/bob/src/api/src/services/push/pushService.ts.

import { and, eq, inArray } from "@bob/db";
import { db } from "@bob/db/client";
import { devicePushTokens, userPreferences } from "@bob/db/schema";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default";
  channelId: string;
  priority: "high" | "default";
  ttl: number;
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

async function enabledTokensForUser(userId: string): Promise<string[]> {
  const rows = await db.query.devicePushTokens.findMany({
    where: and(
      eq(devicePushTokens.userId, userId),
      eq(devicePushTokens.enabled, true),
    ),
    columns: { expoPushToken: true },
  });
  return rows.map((r) => r.expoPushToken);
}

/** The settings toggle (userPreferences.pushNotifications) is authoritative.
 *  Absent row → default true (matches the column default). */
async function pushEnabledForUser(userId: string): Promise<boolean> {
  const pref = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, userId),
    columns: { pushNotifications: true },
  });
  return pref?.pushNotifications ?? true;
}

/**
 * Send a push to every enabled device the user has registered. Best-effort:
 * network/API failures are logged and swallowed (a failed push must never
 * break status handling). Tokens Expo reports as unregistered are pruned.
 */
export async function pushToUser(
  userId: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
    channelId?: string;
    priority?: "high" | "default";
  },
): Promise<void> {
  let tokens: string[];
  try {
    if (!(await pushEnabledForUser(userId))) return;
    tokens = await enabledTokensForUser(userId);
  } catch (err) {
    console.error("[push] token lookup failed:", err);
    return;
  }
  if (tokens.length === 0) return;

  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: "default",
    channelId: notification.channelId ?? "tasks",
    priority: notification.priority ?? "high",
    ttl: 86400,
  }));

  let tickets: ExpoTicket[] = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error(`[push] Expo API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return;
    }
    tickets = ((await res.json()) as { data: ExpoTicket[] }).data ?? [];
  } catch (err) {
    console.error("[push] send failed:", err);
    return;
  }

  // Prune tokens Expo says are dead so we stop trying them.
  const dead: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      const token = tokens[i];
      if (token) dead.push(token);
    }
  });
  if (dead.length > 0) {
    await db
      .delete(devicePushTokens)
      .where(inArray(devicePushTokens.expoPushToken, dead))
      .catch((err) => console.error("[push] prune failed:", err));
  }
}
