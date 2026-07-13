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
  id?: string;
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
): Promise<{ delivered: boolean; tickets: Record<string, string> }> {
  let tokens: string[];
  try {
    if (!(await pushEnabledForUser(userId))) return { delivered: false, tickets: {} };
    tokens = await enabledTokensForUser(userId);
  } catch (err) {
    console.error("[push] token lookup failed:", err);
    // Lookup failure is retryable — signal it upward so the outbox retries.
    throw err instanceof Error ? err : new Error(String(err));
  }
  if (tokens.length === 0) return { delivered: false, tickets: {} };

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
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[push] Expo API ${res.status}: ${detail}`);
      throw new Error(`Expo API ${res.status}`);
    }
    tickets = ((await res.json()) as { data: ExpoTicket[] }).data ?? [];
  } catch (err) {
    console.error("[push] send failed:", err);
    throw err instanceof Error ? err : new Error(String(err));
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

  // Ticket ids by token for the receipts cron (send-time errors have none).
  const ticketMap: Record<string, string> = {};
  tickets.forEach((ticket, i) => {
    const token = tokens[i];
    if (token && ticket.status === "ok" && ticket.id) ticketMap[token] = ticket.id;
  });
  // Surface non-DeviceNotRegistered ticket errors (rate limits, bad payloads)
  // so they aren't silently swallowed.
  const otherErrors = tickets.filter(
    (t) => t.status === "error" && t.details?.error !== "DeviceNotRegistered",
  );
  if (otherErrors.length > 0) {
    console.error(
      `[push] ${otherErrors.length} Expo ticket error(s):`,
      otherErrors.map((t) => t.details?.error ?? t.message).join(", "),
    );
  }
  // delivered = at least one message got an OK ticket. If EVERY ticket errored
  // (and none were DeviceNotRegistered prunes), the send effectively failed —
  // return false so the outbox retries instead of marking the row sent.
  return { delivered: Object.keys(ticketMap).length > 0, tickets: ticketMap };
}

/** Remove device tokens by value (used by the receipts cron). */
export async function pruneTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db
    .delete(devicePushTokens)
    .where(inArray(devicePushTokens.expoPushToken, tokens))
    .catch((err) => console.error("[push] receipt prune failed:", err));
}
