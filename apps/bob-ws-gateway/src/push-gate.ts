/**
 * Should this push go out?
 *
 * The rules live in @bob/notifications/preferences, shared with the API, so the
 * two processes cannot form different opinions about the same user. This file
 * is only the gateway's adapter onto them.
 */

import {
  isWithinQuietHours,
  resolveNotificationDelivery,
} from "@bob/notifications/preferences";
import type {
  NotificationOverrides,
  NotificationType,
  QuietHours,
} from "@bob/notifications/preferences";

export interface PushGateQuery {
  /**
   * Absent for pushes that are not work-item notifications — terminal session
   * events, for instance. Those keep the old behaviour (master switch plus
   * quiet hours); dropping them for lacking a type would silently remove a
   * feature that works today.
   */
  type?: NotificationType;
  masters: { push: boolean; email: boolean };
  overrides: NotificationOverrides;
  quietHours: QuietHours | null;
  now?: Date;
}

export function shouldSendPush(query: PushGateQuery): boolean {
  const { type, masters, overrides, quietHours, now = new Date() } = query;

  if (!type) {
    if (!masters.push) return false;
    // A push at 3am is unwelcome whether or not it carries a type.
    return !(quietHours && isWithinQuietHours(quietHours, now));
  }

  return resolveNotificationDelivery({
    type,
    channel: "push",
    masters,
    overrides,
    quietHours,
    now,
  });
}
