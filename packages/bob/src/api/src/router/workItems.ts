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
  workItemsGet,
  workItemsUpdate,
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
  workItemsMarkNotificationAsRead,
  workItemsRegisterPushToken,
  workItemsTaskRunListByWorkItem,
  workItemsTaskRunExecute,
  workItemsTaskRunListLifecycleEvents,
  workItemsListRecentActivities,
  formatWorkItemIdentifier,
} from "../handlers/workItems";

/**
 * Union of the procedure builders that the factories below accept. Keeping
 * the concrete `typeof` union (rather than `any`) preserves the query/mutation
 * discriminator so tRPC client inference sees `.query()` vs `.mutation()`
 * correctly.
 */
type WorkItemProcedureBuilder =
  | typeof protectedProcedure
  | typeof apiKeyReadProcedure
  | typeof apiKeyWriteProcedure;

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

const listWorkItemsProcedure = buildListWorkItemsProcedure(protectedProcedure);
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

export const workItemRouter = {
  list: listWorkItemsProcedure,
  get: getWorkItemProcedure,
  promoteToTask: promoteToTaskProcedure,
  dispatch: protectedProcedure
    .input(
      z.object({
        workItemId: z.string().uuid(),
        agentType: z.string().default("claude"),
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
};
