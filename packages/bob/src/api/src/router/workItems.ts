import { z } from "zod/v4";

import {
  createArtifactInputSchema,
  createCommentInputSchema,
  createNotificationInputSchema,
  getWorkItemInputSchema,
  listActivitiesInputSchema,
  listChildArtifactGroupsInputSchema,
  listCommentsInputSchema,
  listCurrentArtifactsInputSchema,
  listNotificationsInputSchema,
  listWorkItemsInputSchema,
  workItemStatusCountsInputSchema,
  markAllNotificationsAsReadInputSchema,
  markNotificationAsReadInputSchema,
  promoteToTaskInputSchema,
  updateWorkItemInputSchema,
} from "@bob/work-items/schema";
import {
  apiKeyReadProcedure,
  apiKeyWriteProcedure,
  protectedProcedure,
} from "../trpc";
import {
  workItemsList,
  workItemStatusCounts,
  workItemsGet,
  workItemsUpdate,
  workItemsReorderQueue,
  workItemsPromoteToTask,
  workItemsDispatch,
  workItemsListComments,
  workItemsCreateComment,
  workItemsCreateArtifact,
  workItemsListActivities,
  workItemsListCurrentArtifacts,
  workItemsListChildArtifactGroups,
  workItemsListNotifications,
  workItemsCreateNotification,
  workItemsMarkAllNotificationsAsRead,
  workItemsMarkNotificationAsRead,
  workItemsRegisterPushToken,
  workItemsTaskRunListByWorkItem,
  workItemsTaskRunExecute,
  workItemsTaskRunListLifecycleEvents,
  workItemsListRecentActivities,
} from "../handlers/workItems";

/**
 * Union of the procedure builders that the factories below accept. Keeping
 * the concrete `typeof` union (rather than `any`) preserves the query/mutation
 * discriminator so tRPC client inference sees `.query()` vs `.mutation()`
 * correctly.
 */
type WorkItemProcedureBuilder =
  | typeof protectedProcedure
  | typeof apiKeyReadProcedure;

const buildListWorkItemsProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(listWorkItemsInputSchema).query(({ ctx, input }) =>
    workItemsList({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildGetWorkItemProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(getWorkItemInputSchema).query(({ ctx, input }) =>
    workItemsGet({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildListCommentsProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(listCommentsInputSchema).query(({ ctx, input }) =>
    workItemsListComments({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildCreateCommentProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(createCommentInputSchema).mutation(({ ctx, input }) =>
    workItemsCreateComment({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildCreateArtifactProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(createArtifactInputSchema).mutation(({ ctx, input }) =>
    workItemsCreateArtifact({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildPromoteToTaskProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(promoteToTaskInputSchema).mutation(({ ctx, input }) =>
    workItemsPromoteToTask({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildUpdateWorkItemProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(updateWorkItemInputSchema).mutation(({ ctx, input }) =>
    workItemsUpdate({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const reorderQueueProcedure = protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().uuid(),
      workItemIds: z.array(z.string().uuid()).min(1).max(100),
    }),
  )
  .mutation(({ ctx, input }) =>
    workItemsReorderQueue({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildListActivitiesProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(listActivitiesInputSchema).query(({ ctx, input }) =>
    workItemsListActivities({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildListCurrentArtifactsProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(listCurrentArtifactsInputSchema).query(({ ctx, input }) =>
    workItemsListCurrentArtifacts({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildListChildArtifactGroupsProcedure = <
  T extends WorkItemProcedureBuilder,
>(
  procedure: T,
) =>
  procedure.input(listChildArtifactGroupsInputSchema).query(({ ctx, input }) =>
    workItemsListChildArtifactGroups({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildListNotificationsProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(listNotificationsInputSchema).query(({ ctx, input }) =>
    workItemsListNotifications({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildCreateNotificationProcedure = <T extends WorkItemProcedureBuilder>(
  procedure: T,
) =>
  procedure.input(createNotificationInputSchema).mutation(({ ctx, input }) =>
    workItemsCreateNotification({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildMarkNotificationAsReadProcedure = <
  T extends WorkItemProcedureBuilder,
>(
  procedure: T,
) =>
  procedure.input(markNotificationAsReadInputSchema).mutation(({ ctx, input }) =>
    workItemsMarkNotificationAsRead({ db: ctx.db, userId: ctx.session.user.id }, input),
  );

const buildMarkAllNotificationsAsReadProcedure = <
  T extends WorkItemProcedureBuilder,
>(
  procedure: T,
) =>
  procedure
    .input(markAllNotificationsAsReadInputSchema)
    .mutation(({ ctx }) =>
      workItemsMarkAllNotificationsAsRead({
        db: ctx.db,
        userId: ctx.session.user.id,
      }),
    );

const listWorkItemsProcedure = buildListWorkItemsProcedure(protectedProcedure);
const statusCountsProcedure = protectedProcedure
  .input(workItemStatusCountsInputSchema)
  .query(({ ctx, input }) =>
    workItemStatusCounts({ db: ctx.db, userId: ctx.session.user.id }, input),
  );
const getWorkItemProcedure = buildGetWorkItemProcedure(protectedProcedure);
const updateWorkItemProcedure = buildUpdateWorkItemProcedure(protectedProcedure);
const listCommentsProcedure = buildListCommentsProcedure(protectedProcedure);
const createCommentProcedure = buildCreateCommentProcedure(protectedProcedure);
const createArtifactProcedure = buildCreateArtifactProcedure(protectedProcedure);
const promoteToTaskProcedure = buildPromoteToTaskProcedure(protectedProcedure);
const listActivitiesProcedure = buildListActivitiesProcedure(protectedProcedure);
const listCurrentArtifactsProcedure =
  buildListCurrentArtifactsProcedure(protectedProcedure);
const listChildArtifactGroupsProcedure =
  buildListChildArtifactGroupsProcedure(protectedProcedure);
const listNotificationsProcedure =
  buildListNotificationsProcedure(protectedProcedure);
const createNotificationProcedure =
  buildCreateNotificationProcedure(protectedProcedure);
const markNotificationAsReadProcedure =
  buildMarkNotificationAsReadProcedure(protectedProcedure);
const markAllNotificationsAsReadProcedure =
  buildMarkAllNotificationsAsReadProcedure(protectedProcedure);

const publicListWorkItemsProcedure =
  buildListWorkItemsProcedure(apiKeyReadProcedure);
const publicGetWorkItemProcedure =
  buildGetWorkItemProcedure(apiKeyReadProcedure);
const publicUpdateWorkItemProcedure =
  buildUpdateWorkItemProcedure(apiKeyWriteProcedure);
const publicListCommentsProcedure =
  buildListCommentsProcedure(apiKeyReadProcedure);
const publicCreateCommentProcedure =
  buildCreateCommentProcedure(apiKeyWriteProcedure);
const publicCreateArtifactProcedure =
  buildCreateArtifactProcedure(apiKeyWriteProcedure);
const publicPromoteToTaskProcedure =
  buildPromoteToTaskProcedure(apiKeyWriteProcedure);
const publicListActivitiesProcedure =
  buildListActivitiesProcedure(apiKeyReadProcedure);
const publicListCurrentArtifactsProcedure =
  buildListCurrentArtifactsProcedure(apiKeyReadProcedure);
const publicListChildArtifactGroupsProcedure =
  buildListChildArtifactGroupsProcedure(apiKeyReadProcedure);
const publicListNotificationsProcedure =
  buildListNotificationsProcedure(apiKeyReadProcedure);
const publicCreateNotificationProcedure =
  buildCreateNotificationProcedure(apiKeyWriteProcedure);
const publicMarkNotificationAsReadProcedure =
  buildMarkNotificationAsReadProcedure(apiKeyWriteProcedure);
const publicMarkAllNotificationsAsReadProcedure =
  buildMarkAllNotificationsAsReadProcedure(apiKeyWriteProcedure);

export const workItemRouter = {
  list: listWorkItemsProcedure,
  statusCounts: statusCountsProcedure,
  get: getWorkItemProcedure,
  promoteToTask: promoteToTaskProcedure,
  dispatch: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        // Optional: when omitted, resolved from the work-item override ->
        // project default -> workspace default -> "claude" hierarchy.
        agentType: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      workItemsDispatch(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
};

export const commentRouter = {
  listByWorkItem: listCommentsProcedure,
  create: createCommentProcedure,
};

export const artifactRouter = {
  create: createArtifactProcedure,
  listCurrentByWorkItem: listCurrentArtifactsProcedure,
  listChildGroups: listChildArtifactGroupsProcedure,
};

export const notificationRouter = {
  list: listNotificationsProcedure,
  create: createNotificationProcedure,
  markAsRead: markNotificationAsReadProcedure,
  markAllAsRead: markAllNotificationsAsReadProcedure,

  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        platform: z.enum(["ios", "android", "web"]),
        deviceName: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      workItemsRegisterPushToken(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  // Pull backstop for the push-first trust model: the outbox ledger is the
  // source of truth for run-state transitions, so a push dropped by APNs/FCM
  // is still visible here on next app open (the badge counts these rows).
  unseenTransitions: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.notificationOutbox.findMany({
      where: (outbox, { and, eq, isNull }) =>
        and(eq(outbox.userId, ctx.session.user.id), isNull(outbox.seenAt)),
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
  }),

  markTransitionsSeen: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { notificationOutbox } = await import("@bob/db/schema");
      const { and, eq, inArray, isNull, sql } = await import("@bob/db");
      await ctx.db
        .update(notificationOutbox)
        .set({ seenAt: sql`now()` })
        .where(
          and(
            eq(notificationOutbox.userId, ctx.session.user.id),
            inArray(notificationOutbox.id, input.ids),
            isNull(notificationOutbox.seenAt),
          ),
        );
      return { ok: true };
    }),
};

export const taskRunRouter = {
  listByWorkItem: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      workItemsTaskRunListByWorkItem(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  execute: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        agentType: z.string().default("claude"),
      }),
    )
    .mutation(({ ctx, input }) =>
      workItemsTaskRunExecute(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),

  listLifecycleEvents: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(({ ctx, input }) =>
      workItemsTaskRunListLifecycleEvents(
        { db: ctx.db, userId: ctx.session.user.id },
        input,
      ),
    ),
};

const listRecentActivitiesProcedure = protectedProcedure
  .input(
    z.object({
      limit: z.number().min(1).max(100).default(50),
      workspaceId: z.string().uuid().optional(),
    }),
  )
  .query(({ ctx, input }) =>
    workItemsListRecentActivities(
      { db: ctx.db, userId: ctx.session.user.id },
      input,
    ),
  );

export const activityRouter = {
  listByWorkItem: listActivitiesProcedure,
  listRecent: listRecentActivitiesProcedure,
};

export const workItemsRouter = {
  list: listWorkItemsProcedure,
  get: getWorkItemProcedure,
  update: updateWorkItemProcedure,
  reorderQueue: reorderQueueProcedure,
  promoteToTask: promoteToTaskProcedure,
  listComments: listCommentsProcedure,
  createComment: createCommentProcedure,
  createArtifact: createArtifactProcedure,
  listActivities: listActivitiesProcedure,
  listCurrentArtifacts: listCurrentArtifactsProcedure,
  listChildArtifactGroups: listChildArtifactGroupsProcedure,
  listNotifications: listNotificationsProcedure,
  createNotification: createNotificationProcedure,
  markNotificationAsRead: markNotificationAsReadProcedure,
  markAllNotificationsAsRead: markAllNotificationsAsReadProcedure,
};

export const publicWorkItemsRouter = {
  list: publicListWorkItemsProcedure,
  get: publicGetWorkItemProcedure,
  update: publicUpdateWorkItemProcedure,
  promoteToTask: publicPromoteToTaskProcedure,
  listComments: publicListCommentsProcedure,
  createComment: publicCreateCommentProcedure,
  createArtifact: publicCreateArtifactProcedure,
  listActivities: publicListActivitiesProcedure,
  listCurrentArtifacts: publicListCurrentArtifactsProcedure,
  listChildArtifactGroups: publicListChildArtifactGroupsProcedure,
  listNotifications: publicListNotificationsProcedure,
  createNotification: publicCreateNotificationProcedure,
  markNotificationAsRead: publicMarkNotificationAsReadProcedure,
  markAllNotificationsAsRead: publicMarkAllNotificationsAsReadProcedure,
};
