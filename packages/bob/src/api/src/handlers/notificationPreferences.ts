/**
 * Per-type notification preferences.
 *
 * Reads return the RAW sparse rows. Merging them with defaults is the shared
 * resolver's job (@bob/notifications/preferences) — resolving server-side
 * would freeze today's defaults into every stored response and make changing
 * them a migration.
 */

import { and, eq } from "@bob/db";
import { notificationPreferences } from "@bob/db/schema";
import { notificationChannels } from "@bob/notifications/preferences";
import { workItemNotificationType } from "@bob/work-items/schema";
import { z } from "zod/v4";

import type { HandlerContext } from "./context.js";

export const notificationPreferencesSetInput = z.object({
  type: z.enum(workItemNotificationType),
  // Validated here even though the column is free-form text: this is what
  // stops a row being written that nothing will ever read.
  channel: z.enum(notificationChannels as unknown as [string, ...string[]]),
  // No default — defaulting would silently record an opinion never given.
  enabled: z.boolean(),
});

export type NotificationPreferencesSetInput = z.infer<
  typeof notificationPreferencesSetInput
>;

/** The person's stored opinions. Absent entries mean "use the default". */
export async function notificationPreferencesList(ctx: HandlerContext) {
  return ctx.db.query.notificationPreferences.findMany({
    where: eq(notificationPreferences.userId, ctx.userId),
    columns: { type: true, channel: true, enabled: true },
  });
}

/**
 * Record one opinion. Upserts on (user, type, channel) so toggling a switch
 * twice does not accumulate rows.
 */
export async function notificationPreferencesSet(
  ctx: HandlerContext,
  input: NotificationPreferencesSetInput,
) {
  await ctx.db
    .insert(notificationPreferences)
    .values({
      userId: ctx.userId,
      type: input.type,
      channel: input.channel,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.type,
        notificationPreferences.channel,
      ],
      set: { enabled: input.enabled, updatedAt: new Date().toISOString() },
    });

  return { ok: true as const };
}

/**
 * Drop every stored opinion, returning the person to the defaults.
 *
 * Deleting rather than writing 18 "default" rows keeps the defaults live: if
 * they change, someone who reset gets the new behaviour rather than a frozen
 * copy of the old one.
 */
export async function notificationPreferencesReset(ctx: HandlerContext) {
  await ctx.db
    .delete(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, ctx.userId)));

  return { ok: true as const };
}
