/**
 * SDLC alerts (BOB-81, BOB-75 Phase 4): an SDLC item entered waiting-input,
 * review or failed. The SdlcEdge Durable Object decides who gets what (it holds
 * the state history and the per-user rate limit) and calls this in the
 * background; this writes the inbox row and pushes through
 * createInAppNotification, with the person's per-type preferences applied —
 * the same rules the gateway uses (@bob/notifications/preferences).
 *
 * Best-effort: a failure for one delivery is logged and the rest continue.
 */
import { eq } from "@bob/db";
import type { Db } from "@bob/db/client";
import { notificationPreferences, userPreferences } from "@bob/db/schema";
import { resolveNotificationDelivery } from "@bob/notifications/preferences";
import type { NotificationChannel } from "@bob/notifications/preferences";
import { overridesFromRows, quietHoursFromPreferences } from "@bob/notifications/preferences-rows";

import { createInAppNotification } from "./notificationService.js";

export interface SdlcAlertDelivery {
  userId: string;
  type: "sdlc_waiting_input" | "sdlc_review" | "sdlc_failed";
  title: string;
  body: string;
  /** Null for a summary of several items. */
  itemId: string | null;
  /** The web route, e.g. /sdlc?item=<id>. */
  url: string;
}

type Deliver = (type: SdlcAlertDelivery["type"], channel: NotificationChannel) => boolean;

async function deliveryFor(db: Db, userId: string, now: Date): Promise<Deliver> {
  const [pref, rows] = await Promise.all([
    db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, userId),
      columns: { pushNotifications: true, emailNotifications: true, quietHoursStart: true, quietHoursEnd: true },
    }),
    db.query.notificationPreferences.findMany({
      where: eq(notificationPreferences.userId, userId),
      columns: { type: true, channel: true, enabled: true },
    }),
  ]);
  const masters = { push: pref?.pushNotifications ?? true, email: pref?.emailNotifications ?? true };
  const overrides = overridesFromRows(rows);
  const quietHours = quietHoursFromPreferences(pref ?? null);
  return (type, channel) => resolveNotificationDelivery({ type, channel, masters, overrides, quietHours, now });
}

/** Returns how many inbox rows were written. */
export async function sendSdlcAlerts(db: Db, deliveries: readonly SdlcAlertDelivery[], now = new Date()): Promise<number> {
  const byUser = new Map<string, SdlcAlertDelivery[]>();
  for (const d of deliveries) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  let written = 0;
  for (const [userId, mine] of byUser) {
    let deliver: Deliver;
    try {
      deliver = await deliveryFor(db, userId, now);
    } catch (error) {
      console.warn(`[sdlc] preferences failed for ${userId}:`, error instanceof Error ? error.message : error);
      continue;
    }
    for (const d of mine) {
      const push = deliver(d.type, "push");
      // In-app is the record; with it and push both off, the person asked for nothing.
      if (!push && !deliver(d.type, "in_app")) continue;
      try {
        await createInAppNotification(db, {
          userId,
          type: d.type,
          title: d.title,
          body: d.body,
          url: d.url,
          push,
          // Mobile routes {type:"sdlc", itemId} to /attention/<itemId> (no itemId: /attention).
          pushData: { type: "sdlc", ...(d.itemId ? { itemId: d.itemId } : {}) },
        });
        written += 1;
      } catch (error) {
        console.warn(`[sdlc] alert ${d.type} failed for ${userId}:`, error instanceof Error ? error.message : error);
      }
    }
  }
  return written;
}
