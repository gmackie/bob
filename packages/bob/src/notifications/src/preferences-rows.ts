/**
 * Adapters between stored rows and the pure resolver in ./preferences.ts.
 *
 * Kept separate so the resolver stays free of storage shapes and can be tested
 * without a database.
 */

import { workItemNotificationType } from "@bob/work-items/schema";
import type { WorkItemNotificationType } from "@bob/work-items/schema";

import { notificationChannels } from "./preferences.js";
import type { NotificationChannel, NotificationOverrides, QuietHours } from "./preferences.js";

export interface NotificationPreferenceRow {
  type: string;
  channel: string;
  enabled: boolean;
}

function isKnownType(value: string): value is WorkItemNotificationType {
  return (workItemNotificationType as readonly string[]).includes(value);
}

function isKnownChannel(value: string): value is NotificationChannel {
  return (notificationChannels as readonly string[]).includes(value);
}

/**
 * Sparse rows → overrides. Rows naming a type or channel this build does not
 * know are dropped: the channel column is free-form text, and coercing an
 * unrecognised value into one we do understand would quietly change what a
 * person receives.
 */
export function overridesFromRows(
  rows: readonly NotificationPreferenceRow[],
): NotificationOverrides {
  const out: NotificationOverrides = {};
  for (const row of rows) {
    if (!isKnownType(row.type) || !isKnownChannel(row.channel)) continue;
    (out[row.type] ??= {})[row.channel] = row.enabled;
  }
  return out;
}

/**
 * A window needs both ends. One without the other cannot describe a range, and
 * guessing the missing end would silence notifications nobody asked to
 * silence — so a half-set window is no window.
 */
export function quietHoursFromPreferences(
  prefs: { quietHoursStart?: string | null; quietHoursEnd?: string | null } | null,
): QuietHours | null {
  if (!prefs?.quietHoursStart || !prefs.quietHoursEnd) return null;
  return { start: prefs.quietHoursStart, end: prefs.quietHoursEnd };
}
