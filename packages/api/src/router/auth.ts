import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq, inArray, or } from "@bob/db";
import {
  account,
  activities,
  agentInstances,
  apiKeys,
  browserCookies,
  chatConversations,
  chatMessages,
  comments,
  deviceCodes,
  devicePushTokens,
  dispatchBatches,
  eventLog,
  gitProviderConnections,
  notifications,
  planDrafts,
  projects,
  prReviews,
  pullRequests,
  repositories,
  session,
  sessionConnections,
  sessionEvents,
  sessionSecrets,
  taskRuns,
  tenantMembers,
  user,
  userPreferences,
  webhookConfigs,
  workItems,
  workspaceMembers,
  workspaces,
  worktreeLinks,
  worktreePlans,
  worktrees,
} from "@bob/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

type ExportRow = Record<string, unknown>;

const redactFields = (row: ExportRow, fields: string[]) => {
  const redacted = { ...row };

  for (const field of fields) {
    if (field in redacted && redacted[field] != null) {
      redacted[field] = "[redacted]";
    }
  }

  return redacted;
};

const redactRows = (rows: ExportRow[], fields: string[]) =>
  rows.map((row) => redactFields(row, fields));

const sensitiveAuthAccountFields = [
  "accessToken",
  "refreshToken",
  "idToken",
  "password",
];

const sensitiveAuthSessionFields = ["token"];

const sensitiveApiKeyFields = ["keyHash"];

const sensitiveCookieFields = ["valueCiphertext", "valueIv", "valueTag"];

const sensitiveDeviceCodeFields = ["apiKey"];

const sensitiveDevicePushTokenFields = ["expoPushToken"];

const sensitiveGitProviderConnectionFields = [
  "accessTokenCiphertext",
  "accessTokenIv",
  "accessTokenTag",
  "refreshTokenCiphertext",
  "refreshTokenIv",
  "refreshTokenTag",
];

const sensitiveSessionSecretFields = ["valueCiphertext", "valueIv", "valueTag"];

const sensitiveWebhookConfigFields = ["secret"];

export const authRouter = {
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),
  getSecretMessage: protectedProcedure.query(() => {
    return "you can see this secret message!";
  }),
  exportData: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [
      userRows,
      authSessions,
      authAccounts,
      preferences,
      keys,
      codes,
      tenantMemberships,
      workspaceMemberships,
      ownedWorkspaces,
      ownedOrAssignedWorkItems,
      ownedProjects,
      repoRows,
      worktreeRows,
      agentRows,
      conversations,
      batches,
      events,
      cookieRows,
      secretRows,
      gitConnections,
      prs,
      reviews,
      webhooks,
      runs,
      commentRows,
      activityRows,
      notificationRows,
      pushTokens,
      plans,
      links,
    ] = await Promise.all([
      ctx.db.select().from(user).where(eq(user.id, userId)),
      ctx.db.select().from(session).where(eq(session.userId, userId)),
      ctx.db.select().from(account).where(eq(account.userId, userId)),
      ctx.db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId)),
      ctx.db.select().from(apiKeys).where(eq(apiKeys.userId, userId)),
      ctx.db.select().from(deviceCodes).where(eq(deviceCodes.userId, userId)),
      ctx.db
        .select()
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId)),
      ctx.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, userId)),
      ctx.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerUserId, userId)),
      ctx.db
        .select()
        .from(workItems)
        .where(
          or(
            eq(workItems.ownerUserId, userId),
            eq(workItems.assigneeUserId, userId),
          ),
        ),
      ctx.db.select().from(projects).where(eq(projects.leadUserId, userId)),
      ctx.db.select().from(repositories).where(eq(repositories.userId, userId)),
      ctx.db.select().from(worktrees).where(eq(worktrees.userId, userId)),
      ctx.db
        .select()
        .from(agentInstances)
        .where(eq(agentInstances.userId, userId)),
      ctx.db
        .select()
        .from(chatConversations)
        .where(eq(chatConversations.userId, userId)),
      ctx.db
        .select()
        .from(dispatchBatches)
        .where(eq(dispatchBatches.userId, userId)),
      ctx.db.select().from(eventLog).where(eq(eventLog.userId, userId)),
      ctx.db
        .select()
        .from(browserCookies)
        .where(eq(browserCookies.userId, userId)),
      ctx.db
        .select()
        .from(sessionSecrets)
        .where(eq(sessionSecrets.userId, userId)),
      ctx.db
        .select()
        .from(gitProviderConnections)
        .where(eq(gitProviderConnections.userId, userId)),
      ctx.db.select().from(pullRequests).where(eq(pullRequests.userId, userId)),
      ctx.db.select().from(prReviews).where(eq(prReviews.userId, userId)),
      ctx.db
        .select()
        .from(webhookConfigs)
        .where(eq(webhookConfigs.userId, userId)),
      ctx.db.select().from(taskRuns).where(eq(taskRuns.userId, userId)),
      ctx.db.select().from(comments).where(eq(comments.userId, userId)),
      ctx.db.select().from(activities).where(eq(activities.userId, userId)),
      ctx.db
        .select()
        .from(notifications)
        .where(
          or(
            eq(notifications.userId, userId),
            eq(notifications.actorId, userId),
          ),
        ),
      ctx.db
        .select()
        .from(devicePushTokens)
        .where(eq(devicePushTokens.userId, userId)),
      ctx.db
        .select()
        .from(worktreePlans)
        .where(eq(worktreePlans.userId, userId)),
      ctx.db
        .select()
        .from(worktreeLinks)
        .where(eq(worktreeLinks.userId, userId)),
    ]);

    const conversationIds = conversations.map(({ id }) => id);
    const messageRows =
      conversationIds.length > 0
        ? await ctx.db
            .select()
            .from(chatMessages)
            .where(inArray(chatMessages.conversationId, conversationIds))
        : [];
    const sessionEventRows =
      conversationIds.length > 0
        ? await ctx.db
            .select()
            .from(sessionEvents)
            .where(inArray(sessionEvents.sessionId, conversationIds))
        : [];
    const connectionRows =
      conversationIds.length > 0
        ? await ctx.db
            .select()
            .from(sessionConnections)
            .where(inArray(sessionConnections.sessionId, conversationIds))
        : [];
    const planDraftRows =
      conversationIds.length > 0
        ? await ctx.db
            .select()
            .from(planDrafts)
            .where(inArray(planDrafts.sessionId, conversationIds))
        : [];

    return {
      exportedAt: new Date().toISOString(),
      userId,
      data: {
        user: userRows,
        authSessions: redactRows(authSessions, sensitiveAuthSessionFields),
        authAccounts: redactRows(authAccounts, sensitiveAuthAccountFields),
        userPreferences: preferences,
        apiKeys: redactRows(keys, sensitiveApiKeyFields),
        deviceCodes: redactRows(codes, sensitiveDeviceCodeFields),
        tenantMembers: tenantMemberships,
        workspaceMembers: workspaceMemberships,
        workspaces: ownedWorkspaces,
        projects: ownedProjects,
        workItems: ownedOrAssignedWorkItems,
        repositories: repoRows,
        worktrees: worktreeRows,
        agentInstances: agentRows,
        chatConversations: conversations,
        chatMessages: messageRows,
        sessionEvents: sessionEventRows,
        sessionConnections: connectionRows,
        planDrafts: planDraftRows,
        dispatchBatches: batches,
        eventLog: events,
        browserCookies: redactRows(cookieRows, sensitiveCookieFields),
        sessionSecrets: redactRows(secretRows, sensitiveSessionSecretFields),
        gitProviderConnections: redactRows(
          gitConnections,
          sensitiveGitProviderConnectionFields,
        ),
        pullRequests: prs,
        prReviews: reviews,
        webhookConfigs: redactRows(webhooks, sensitiveWebhookConfigFields),
        taskRuns: runs,
        comments: commentRows,
        activities: activityRows,
        notifications: notificationRows,
        devicePushTokens: redactRows(
          pushTokens,
          sensitiveDevicePushTokenFields,
        ),
        worktreePlans: plans,
        worktreeLinks: links,
      },
    };
  }),
  deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const deletedUsers = await ctx.db.transaction(async (tx) => {
      await tx.delete(tenantMembers).where(eq(tenantMembers.userId, userId));
      await tx.delete(prReviews).where(eq(prReviews.userId, userId));
      await tx
        .update(workItems)
        .set({ assigneeUserId: null })
        .where(eq(workItems.assigneeUserId, userId));

      return tx
        .delete(user)
        .where(eq(user.id, userId))
        .returning({ id: user.id });
    });

    if (deletedUsers.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User account not found",
      });
    }

    return {
      deleted: true,
      userId,
    };
  }),
} satisfies TRPCRouterRecord;
