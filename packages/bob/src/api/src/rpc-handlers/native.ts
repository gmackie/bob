import type { Rpc } from "effect/unstable/rpc";
import type * as Contract from "@gmacko/bob/contracts";

import { and, eq, inArray, isNull, sql } from "@bob/db";
import { notificationOutbox } from "@bob/db/schema";

import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  notificationPreferencesList,
  notificationPreferencesReset,
  notificationPreferencesSet,
} from "../handlers/notificationPreferences.js";
import { workItemsReorderQueue } from "../handlers/workItems.js";
import { makeProjectRpcHandlers } from "./project.js";

interface Args<R extends Rpc.Any> {
  payload: Rpc.Payload<R>;
}
export const makeNativeRpcHandlers = (ctx: HandlerContext) => {
  const project = makeProjectRpcHandlers(ctx);
  return {
    "project.list": project["project.list"],
    "project.get": project["project.get"],
    "project.create": project["project.create"],
    "project.updateAutomationSettings":
      project["project.updateAutomationSettings"],
    "project.setDefaultAgent": project["project.setDefaultAgent"],

    "workItem.reorderQueue": ({
      payload,
    }: Args<typeof Contract.ReorderQueueRpc>) =>
      wrapHandler(
        workItemsReorderQueue,
        ctx,
        { ...payload, workItemIds: [...payload.workItemIds] },
        "workItem",
      ),
    "settings.listNotificationPreferences": () =>
      wrapHandler(notificationPreferencesList, ctx, undefined, "settings"),
    "settings.setNotificationPreference": ({
      payload,
    }: Args<typeof Contract.SetNotificationPreferenceRpc>) =>
      wrapHandler(notificationPreferencesSet, ctx, payload, "settings"),
    "settings.resetNotificationPreferences": () =>
      wrapHandler(notificationPreferencesReset, ctx, undefined, "settings"),
    "notification.unseenTransitions": () =>
      wrapHandler(
        async (c) => {
          const rows = await c.db.query.notificationOutbox.findMany({
            where: and(
              eq(notificationOutbox.userId, c.userId),
              isNull(notificationOutbox.seenAt),
            ),
            orderBy: (outbox, { desc }) => [desc(outbox.createdAt)],
            limit: 50,
            columns: {
              id: true,
              sessionId: true,
              transition: true,
              payload: true,
              createdAt: true,
            },
          });
          return { count: rows.length, rows };
        },
        ctx,
        undefined,
        "notification",
      ),
    "notification.markTransitionsSeen": ({
      payload,
    }: Args<typeof Contract.MarkTransitionsSeenRpc>) =>
      wrapHandler(
        async (c) => {
          await c.db
            .update(notificationOutbox)
            .set({ seenAt: sql`now()` })
            .where(
              and(
                eq(notificationOutbox.userId, c.userId),
                inArray(notificationOutbox.id, [...payload.ids]),
                isNull(notificationOutbox.seenAt),
              ),
            );
          return { ok: true };
        },
        ctx,
        undefined,
        "notification",
      ),
  };
};
