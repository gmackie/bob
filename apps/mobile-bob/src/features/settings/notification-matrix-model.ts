/**
 * Presentation model for the notification matrix.
 *
 * Separate from the screen so the rules are testable without a React Native
 * runtime, and so the ordering and labelling decisions are stated once.
 *
 * The delivery rules themselves are NOT re-implemented here — they live in
 * @bob/notifications/preferences, shared with the gateway and the API. This
 * only decides how they are shown.
 */

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationChannels,
} from "@bob/notifications/preferences";
import type {
  NotificationChannel,
  NotificationOverrides,
  NotificationType,
} from "@bob/notifications/preferences";

/**
 * Blocking events first. The two a person must act on lead the screen rather
 * than being buried under routine chatter — the ordering is the argument the
 * defaults are making, made visible.
 */
const ROW_ORDER: NotificationType[] = [
  "work_item_needs_input",
  "work_item_review_ready",
  "work_item_assigned",
  "work_item_commented",
  "task_completed",
  "batch_completed",
];

/** Human labels. The enum values are Bob's vocabulary, not a person's. */
const ROW_LABELS: Record<NotificationType, string> = {
  work_item_needs_input: "Needs input",
  work_item_review_ready: "Review ready",
  work_item_assigned: "Assigned to me",
  work_item_commented: "Commented",
  task_completed: "Task completed",
  batch_completed: "Batch completed",
};

/** One line each, so a person can tell the rows apart without guessing. */
const ROW_HINTS: Record<NotificationType, string> = {
  work_item_needs_input: "An agent is blocked waiting on you",
  work_item_review_ready: "Work is ready for your review",
  work_item_assigned: "A work item was assigned to you",
  work_item_commented: "Someone commented on your work item",
  task_completed: "A single task finished",
  batch_completed: "A dispatch batch finished",
};

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  push: "Push",
  email: "Email",
  in_app: "In-app",
};

export interface MatrixInput {
  masters: { push: boolean; email: boolean };
  overrides: NotificationOverrides;
}

export interface MatrixCell {
  channel: NotificationChannel;
  enabled: boolean;
  /**
   * True when the channel's master switch is off. The row reads as inert, but
   * `enabled` still carries the person's stored choice so it returns intact
   * when they re-enable the channel.
   */
  disabled: boolean;
}

export interface MatrixRow {
  type: NotificationType;
  label: string;
  hint: string;
  channels: Record<NotificationChannel, MatrixCell>;
}

function cellEnabled(
  type: NotificationType,
  channel: NotificationChannel,
  overrides: NotificationOverrides,
): boolean {
  return overrides[type]?.[channel] ?? DEFAULT_NOTIFICATION_PREFERENCES[type][channel];
}

function channelDisabled(
  channel: NotificationChannel,
  masters: MatrixInput["masters"],
): boolean {
  // In-app is not governed by a master switch: it is the record of what
  // happened, and muting a phone must not erase history.
  if (channel === "in_app") return false;
  return channel === "push" ? !masters.push : !masters.email;
}

export function buildNotificationMatrix({ masters, overrides }: MatrixInput): MatrixRow[] {
  return ROW_ORDER.map((type) => ({
    type,
    label: ROW_LABELS[type],
    hint: ROW_HINTS[type],
    channels: Object.fromEntries(
      notificationChannels.map((channel) => [
        channel,
        {
          channel,
          enabled: cellEnabled(type, channel, overrides),
          disabled: channelDisabled(channel, masters),
        },
      ]),
    ) as Record<NotificationChannel, MatrixCell>,
  }));
}

/**
 * The one-line subtitle on the settings index. It has to be true at a glance —
 * a count of switches would be accurate and useless.
 */
export function summariseNotificationPreferences({ masters, overrides }: MatrixInput): string {
  if (!masters.push) return "Push off";

  const pushing = ROW_ORDER.filter((type) => cellEnabled(type, "push", overrides));
  if (pushing.length === ROW_ORDER.length) return "All events";
  if (pushing.length === 0) return "No push events";

  const isDefaultPosture =
    pushing.length === 2 &&
    pushing.includes("work_item_needs_input") &&
    pushing.includes("work_item_review_ready");
  if (isDefaultPosture) return "Blocking events only";

  return `${pushing.length} event${pushing.length === 1 ? "" : "s"}`;
}
