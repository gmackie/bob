import { sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Auth tables now live in @bob/auth/schema (Phase 7B-2 Task 9).
// Re-exported here so existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/auth/schema";

// Tenancy tables now live in @bob/tenancy/schema (Phase 7B-2 Task 8).
// Re-exported here so existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/tenancy/schema";
import { workspaces } from "@bob/tenancy/schema";

// userPreferences now lives in @bob/settings/schema (Phase 7B-2 Task 10).
// Re-exported here so existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/settings/schema";

// Projects-area tables (projects, repositories, discoveredDirs, worktrees,
// worktreePlans, worktreeLinks) now live in @bob/projects/schema (Phase 7B-2
// Task 11). Re-exported here so existing `from "@bob/db/schema"` import sites
// keep working.
export * from "@bob/projects/schema";

// Work-items area tables (workItems, planDrafts, planDraftDependencies,
// workItemDependencies, dispatchBatches, dispatchItems, requirements,
// planTaskItems, taskRuns, comments, workItemArtifacts, workItemSnapshots)
// now live in @bob/work-items/schema (Phase 7B-2 Task 12). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/work-items/schema";
// workItemActivityTypeEnum, workItemNotificationType,
// workItemNotificationTypeEnum, workItems — no longer imported here;
// consumed only by @bob/notifications/schema (Phase 7B-2 Task 18).

// Agents-area tables (agentRuns, runArtifacts, agentInstances, tokenUsageSessions,
// instanceUsageSummary, dailyUsageStats, sessionEvents, sessionConnections,
// runLifecycleEvents, sessionCheckpoints, skills, skillExecutions) now live in
// @bob/agents/schema (Phase 7B-2 Task 13). Re-exported here so existing
// `from "@bob/db/schema"` import sites keep working.
export * from "@bob/agents/schema";

// Chat-area tables (chatConversations, chatMessages, chatAttachments) now live
// in @bob/chat/schema (Phase 7B-2 Task 14). Re-exported here so existing
// `from "@bob/db/schema"` import sites keep working.
export * from "@bob/chat/schema";

// Git-area tables (gitProviderConnections, pullRequests, prReviews,
// featureBranches, featureBranchTaskPRs, gitCommits) + enums
// (gitProviderEnum, prStatusEnum, prReviewStatusEnum, webhookStatusEnum)
// now live in @bob/git/schema (Phase 7B-2 Task 15). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/git/schema";

// Webhooks-area tables (webhookConfigs, webhookDeliveries) + relations now
// live in @bob/webhooks/schema (Phase 7B-2 Task 16). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/webhooks/schema";

// CI/forge tables (forgeRevisions, forgeBuilds, forgeDeployments,
// forgeRunEvents) + enums + relations now live in @bob/ci/schema (Phase 7B-2
// Task 17). Re-exported here so existing `from "@bob/db/schema"` import sites
// keep working.
export * from "@bob/ci/schema";

// Notifications-area tables (eventLog, activities, notifications,
// devicePushTokens) + eventTypeEnum + relations now live in
// @bob/notifications/schema (Phase 7B-2 Task 18). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/notifications/schema";

// Cookies-area tables (browserCookies, sessionCookieScopes) + enums
// (cookieSourceEnum, sameSiteEnum) + relations now live in
// @bob/cookies/schema (Phase 7B-2 Task 19). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/cookies/schema";

// Secrets-area tables (sessionSecrets, sessionSecretUsages,
// projectDeploySecretBindings) + relations now live in
// @bob/secrets/schema (Phase 7B-2 Task 20). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/secrets/schema";

export const Post = pgTable("post", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  title: t.varchar({ length: 256 }).notNull(),
  content: t.text().notNull(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreatePostSchema = createInsertSchema(Post, {
  title: z.string().max(256),
  content: z.string().max(256),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// userPreferences moved to @bob/settings/schema (Phase 7B-2 Task 10).

// --- apiKeys + deviceCodes moved to @bob/auth/schema (Phase 7B-2 Task 9) ---

// --- Tenants moved to @bob/tenancy/schema (Phase 7B-2 Task 8) ---

// agentRunStatusEnum / agentRuns / runArtifactTypeEnum / runArtifacts moved to
// @bob/agents/schema (Phase 7B-2 Task 13).

// workItemKind / WorkItemKind / workItemKindEnum moved to @bob/work-items/schema
// (Phase 7B-2 Task 12).

// workspaceMemberRole / workspaceMemberRoleEnum moved to @bob/tenancy/schema (Phase 7B-2 Task 8).

// projectStatus / ProjectStatus / projectStatusEnum moved to @bob/projects/schema (Phase 7B-2 Task 11).

// workItemActivityType / workItemActivityTypeEnum moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// workItemNotificationType / workItemNotificationTypeEnum moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// workItemArtifactType / workItemArtifactTypeEnum moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// workItemArtifactProducerType / workItemArtifactProducerTypeEnum moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// workItems / CreateWorkItemSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// planDrafts / planDraftDependencies / planDraftsRelations / planDraftDependenciesRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// workItemDependencies / workItemDependenciesRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// dispatchBatches / dispatchItems / dispatchBatchesRelations / dispatchItemsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// CreateUserPreferencesSchema + UpdateUserPreferencesSchema moved to
// @bob/settings/schema (Phase 7B-2 Task 10).

// workspaces table moved to @bob/tenancy/schema (Phase 7B-2 Task 8).

export const CreateWorkspaceSchema = createInsertSchema(workspaces, {
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
}).omit({
  id: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
});

// workspaceMembers table moved to @bob/tenancy/schema (Phase 7B-2 Task 8).

// projects + CreateProjectSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).
// agentTypeEnum + instanceStatusEnum colocated with @bob/projects/schema for now
// (used by CreateWorktreeSchema; see note in projects/schema.ts).
// repositories + CreateRepositorySchema moved to @bob/projects/schema (Phase 7B-2 Task 11).
// discoveredDirs moved to @bob/projects/schema (Phase 7B-2 Task 11).
// worktrees + CreateWorktreeSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).

// agentInstances / CreateAgentInstanceSchema / tokenUsageSessions /
// instanceUsageSummary / dailyUsageStats moved to @bob/agents/schema
// (Phase 7B-2 Task 13).

// repositoriesRelations moved to @bob/projects/schema (Phase 7B-2 Task 11).
// `instances: many(agentInstances)` re-enabled there in Task 13.

// requirementCategory / requirementStatus / RequirementCategory / RequirementStatus
// moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// requirements / requirementsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// workItemsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// workspacesRelations + workspaceMembersRelations moved to @bob/tenancy/schema (Phase 7B-2 Task 8).

// projectsRelations + worktreesRelations moved to @bob/projects/schema (Phase 7B-2 Task 11).
// `worktreesRelations.instances: many(agentInstances)` re-enabled there in Task 13.

// agentInstancesRelations moved to @bob/agents/schema (Phase 7B-2 Task 13).

// messageRoleEnum / MessageRole / sessionStatusEnum / SessionStatus /
// workflowStatusEnum / WorkflowStatus moved to @bob/agents/schema
// (Phase 7B-2 Task 13).

// chatConversations / chatMessages / chatAttachments + their relations moved
// to @bob/chat/schema (Phase 7B-2 Task 14).

// planStatusEnum / PlanStatus moved to @bob/projects/schema (Phase 7B-2 Task 11).

// taskStatusEnum / TaskStatus moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// linkTypeEnum / LinkType moved to @bob/projects/schema (Phase 7B-2 Task 11).

// eventTypeEnum / EventType moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// worktreePlans + CreateWorktreePlanSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).
// worktreeLinks + CreateWorktreeLinkSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).

// planTaskItems / CreatePlanTaskItemSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// eventLog moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// sessionEventDirectionEnum / SessionEventDirection / sessionEventTypeEnum /
// SessionEventType / sessionEvents / deviceTypeEnum / DeviceType /
// sessionConnections moved to @bob/agents/schema (Phase 7B-2 Task 13).

// worktreePlansRelations + worktreeLinksRelations moved to @bob/projects/schema
// (Phase 7B-2 Task 11). `worktreePlansRelations.tasks: many(planTaskItems)`
// re-enabled in @bob/projects/schema during Phase 7B-2 Task 12.

// planTaskItemsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// eventLogRelations moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// sessionEventsRelations / sessionConnectionsRelations / sessionCheckpointsRelations
// moved to @bob/agents/schema (Phase 7B-2 Task 14).

// gitProviderEnum / GitProvider / prStatusEnum / PRStatus / prReviewStatusEnum /
// PRReviewStatus / prReviewStatusPgEnum / webhookStatusEnum / WebhookStatus
// moved to @bob/git/schema (Phase 7B-2 Task 15).

// taskRunStatusEnum / TaskRunStatus moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// gitProviderConnections / CreateGitProviderConnectionSchema moved to
// @bob/git/schema (Phase 7B-2 Task 15).

// cookieSourceEnum / sameSiteEnum / browserCookies / sessionCookieScopes
// moved to @bob/cookies/schema (Phase 7B-2 Task 19).

// sessionSecrets / sessionSecretUsages / projectDeploySecretBindings moved to
// @bob/secrets/schema (Phase 7B-2 Task 20).

// pullRequests / CreatePullRequestSchema / prReviews / featureBranches /
// featureBranchTaskPRs / gitCommits / CreateGitCommitSchema moved to
// @bob/git/schema (Phase 7B-2 Task 15).

// webhookConfigs / CreateWebhookConfigSchema / webhookDeliveries /
// CreateWebhookDeliverySchema moved to @bob/webhooks/schema (Phase 7B-2 Task 16).

// taskRuns / CreateTaskRunSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// comments / CreateCommentSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// activities moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// workItemArtifacts / CreateWorkItemArtifactSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// notifications / CreateNotificationSchema moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// devicePushTokens / CreateDevicePushTokenSchema moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// gitProviderConnectionsRelations / pullRequestsRelations / prReviewsRelations /
// featureBranchesRelations / featureBranchTaskPRsRelations / gitCommitsRelations
// moved to @bob/git/schema (Phase 7B-2 Task 15).

// taskRunsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// `taskRunsRelations.session: one(chatConversations)` is commented out there
// pending Task 14 (chat). `taskRunsRelations.pullRequest: one(pullRequests)`
// re-enabled in Task 15 (git).

// runLifecycleEvents / runLifecycleEventsRelations moved to @bob/agents/schema
// (Phase 7B-2 Task 13).

// commentsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// activitiesRelations moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// workItemArtifactsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// notificationsRelations moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// devicePushTokensRelations moved to @bob/notifications/schema (Phase 7B-2 Task 18).

// webhookConfigsRelations / webhookDeliveriesRelations moved to
// @bob/webhooks/schema (Phase 7B-2 Task 16).

// forgeRevisionStatusEnum / forgeRevisions / forgeBuildStatusEnum / forgeBuilds /
// forgeDeploymentEnvEnum / forgeDeploymentStatusEnum / forgeDeployments /
// forgeRunEventTypeEnum / forgeRunEvents + all forge relations moved to
// @bob/ci/schema (Phase 7B-2 Task 17).


// skillCategory / SkillCategory / skillCategoryEnum / skillSource / SkillSource /
// skillSourceEnum / skillExecutionStatus / SkillExecutionStatus /
// skillExecutionStatusEnum / skills / skillsRelations / skillExecutions /
// skillExecutionsRelations moved to @bob/agents/schema (Phase 7B-2 Task 13).

// workItemSnapshots / workItemSnapshotsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// sessionCheckpoints + sessionCheckpointsRelations moved to @bob/agents/schema
// (Phase 7B-2 Task 13 table, Task 14 relations).

// tenantsRelations + tenantMembersRelations moved to @bob/tenancy/schema (Phase 7B-2 Task 8).

// agentRunsRelations / runArtifactsRelations moved to @bob/agents/schema
// (Phase 7B-2 Task 13).

// browserCookiesRelations / sessionCookieScopesRelations moved to
// @bob/cookies/schema (Phase 7B-2 Task 19).

// sessionSecretsRelations / sessionSecretUsagesRelations /
// projectDeploySecretBindingsRelations moved to @bob/secrets/schema
// (Phase 7B-2 Task 20).

// sessionEventsRelations / sessionConnectionsRelations /
// sessionCheckpointsRelations moved to @bob/agents/schema (Phase 7B-2 Task 14,
// now that chatConversations lives in @bob/chat/schema).

