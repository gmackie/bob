/**
 * Which notifications reach a person, resolved in ONE place.
 *
 * Delivery used to be two booleans — `pushNotifications` and
 * `emailNotifications` — so the only settings were "every event" or "silence".
 * Bob emits six quite different events, and the one that matters (an agent
 * blocked, waiting on you) arrived in the same undifferentiated stream as
 * "batch completed". People learn to ignore a stream like that, which costs
 * exactly the events it exists to deliver.
 *
 * This module is pure and shared on purpose. The ws-gateway sends pushes and
 * the API sends email; a second copy of these rules in either would drift, and
 * two processes disagreeing about the same user is a failure mode this repo
 * has already paid for.
 */

import { workItemNotificationType } from "@bob/work-items/schema";
import type { WorkItemNotificationType } from "@bob/work-items/schema";

/** Re-exported so consumers (the ws-gateway) need only this module, not a
 *  dependency on @bob/work-items just to name a type. */
export type NotificationType = WorkItemNotificationType;

export type NotificationChannel = "push" | "email" | "in_app";

export const notificationChannels: readonly NotificationChannel[] = [
  "push",
  "email",
  "in_app",
];

/** Per-type, per-channel defaults used when a person has expressed no opinion. */
export type NotificationDefaults = Record<
  WorkItemNotificationType,
  Record<NotificationChannel, boolean>
>;

/**
 * Defaults chosen so the loudest channel carries only what a person must act
 * on. Push is reserved for "you are the blocker": an agent waiting on input,
 * or work ready for your review. Everything else is still recorded in-app, so
 * nothing is lost — it just does not buzz a phone.
 *
 * Email defaults off everywhere. Nobody asked Bob for more email, and it is
 * the one channel a person cannot easily catch up on later.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationDefaults = {
  work_item_needs_input: { push: true, email: false, in_app: true },
  work_item_review_ready: { push: true, email: false, in_app: true },
  work_item_assigned: { push: false, email: false, in_app: true },
  work_item_commented: { push: false, email: false, in_app: true },
  task_completed: { push: false, email: false, in_app: true },
  batch_completed: { push: false, email: false, in_app: true },
};

/** Sparse per-type overrides; absent entries fall back to the defaults. */
export type NotificationOverrides = Partial<
  Record<WorkItemNotificationType, Partial<Record<NotificationChannel, boolean>>>
>;

export interface QuietHours {
  /** "HH:MM", 24h. */
  start: string;
  end: string;
}

export interface DeliveryQuery {
  type: WorkItemNotificationType;
  channel: NotificationChannel;
  /** The legacy top-level switches, still authoritative as a veto. */
  masters: { push: boolean; email: boolean };
  overrides: NotificationOverrides;
  quietHours?: QuietHours | null;
  now?: Date;
}

/** Minutes since midnight, or null when the value is not "HH:MM". */
function minutesOfDay(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Is `now` inside the window? Windows routinely cross midnight (22:00–08:00),
 * so the crossing case is the normal one rather than an edge case.
 */
export function isWithinQuietHours(quiet: QuietHours, now: Date): boolean {
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  // An unreadable window is treated as no window. Failing the other way would
  // silence a person's notifications with nothing to explain why.
  if (start === null || end === null) return false;
  if (start === end) return false;

  const at = now.getUTCHours() * 60 + now.getUTCMinutes();
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/**
 * The single answer to "does this notification go out on this channel?".
 *
 * In-app is deliberately exempt from both the master switches and quiet hours:
 * it is the record of what happened, not an interruption. Muting a phone must
 * not erase history.
 */
export function resolveNotificationDelivery(query: DeliveryQuery): boolean {
  const { type, channel, masters, overrides, quietHours, now = new Date() } = query;

  const defaults = DEFAULT_NOTIFICATION_PREFERENCES[type];
  if (!defaults) return false;

  const wanted = overrides[type]?.[channel] ?? defaults[channel];
  if (!wanted) return false;

  if (channel === "in_app") return true;

  // The master switch is an absolute veto — otherwise turning push off in
  // settings would be a lie.
  if (channel === "push" && !masters.push) return false;
  if (channel === "email" && !masters.email) return false;

  if (quietHours && isWithinQuietHours(quietHours, now)) return false;

  return true;
}

/** Every (type, channel) pair, for rendering the settings matrix. */
export function notificationMatrix(): {
  type: WorkItemNotificationType;
  channels: NotificationChannel[];
}[] {
  return workItemNotificationType.map((type) => ({
    type,
    channels: [...notificationChannels],
  }));
}
