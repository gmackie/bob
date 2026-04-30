import { relations, sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";

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
import {
  projects,
  repositories,
  worktrees,
} from "@bob/projects/schema";

// Work-items area tables (workItems, planDrafts, planDraftDependencies,
// workItemDependencies, dispatchBatches, dispatchItems, requirements,
// planTaskItems, taskRuns, comments, workItemArtifacts, workItemSnapshots)
// now live in @bob/work-items/schema (Phase 7B-2 Task 12). Re-exported here so
// existing `from "@bob/db/schema"` import sites keep working.
export * from "@bob/work-items/schema";
import {
  workItemActivityTypeEnum,
  workItemNotificationType,
  workItemNotificationTypeEnum,
  workItems,
} from "@bob/work-items/schema";

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
import { chatConversations } from "@bob/chat/schema";

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

export const eventTypeEnum = [
  "instance.started",
  "instance.stopped",
  "instance.error",
  "git.commit",
  "git.push",
  "git.pull",
  "git.checkout",
  "file.created",
  "file.modified",
  "file.deleted",
  "plan.created",
  "plan.updated",
  "plan.task_completed",
  "chat.message",
  "chat.tool_call",
  "chat.tool_result",
  "worktree.created",
  "worktree.deleted",
  "link.created",
  "link.removed",
] as const;
export type EventType = (typeof eventTypeEnum)[number];

// worktreePlans + CreateWorktreePlanSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).
// worktreeLinks + CreateWorktreeLinkSchema moved to @bob/projects/schema (Phase 7B-2 Task 11).

// planTaskItems / CreatePlanTaskItemSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

export const eventLog = pgTable("event_log", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  eventType: t.varchar({ length: 50 }).notNull(),
  payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

// sessionEventDirectionEnum / SessionEventDirection / sessionEventTypeEnum /
// SessionEventType / sessionEvents / deviceTypeEnum / DeviceType /
// sessionConnections moved to @bob/agents/schema (Phase 7B-2 Task 13).

// worktreePlansRelations + worktreeLinksRelations moved to @bob/projects/schema
// (Phase 7B-2 Task 11). `worktreePlansRelations.tasks: many(planTaskItems)`
// re-enabled in @bob/projects/schema during Phase 7B-2 Task 12.

// planTaskItemsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  user: one(user, {
    fields: [eventLog.userId],
    references: [user.id],
  }),
  worktree: one(worktrees, {
    fields: [eventLog.worktreeId],
    references: [worktrees.id],
  }),
  repository: one(repositories, {
    fields: [eventLog.repositoryId],
    references: [repositories.id],
  }),
}));

// sessionEventsRelations / sessionConnectionsRelations / sessionCheckpointsRelations
// moved to @bob/agents/schema (Phase 7B-2 Task 14).

// gitProviderEnum / GitProvider / prStatusEnum / PRStatus / prReviewStatusEnum /
// PRReviewStatus / prReviewStatusPgEnum / webhookStatusEnum / WebhookStatus
// moved to @bob/git/schema (Phase 7B-2 Task 15).

// taskRunStatusEnum / TaskRunStatus moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// gitProviderConnections / CreateGitProviderConnectionSchema moved to
// @bob/git/schema (Phase 7B-2 Task 15).

// ── Browser Cookie Jar ─────────────────────────────────────────────

export const cookieSourceEnum = ["extension", "cli"] as const;
export const sameSiteEnum = ["Strict", "Lax", "None"] as const;

export const browserCookies = pgTable(
  "browser_cookies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    name: t.text().notNull(),
    valueCiphertext: t.text().notNull(),
    valueIv: t.text().notNull(),
    valueTag: t.text().notNull(),
    path: t.text().notNull().default("/"),
    expires: t.timestamp({ mode: "string", withTimezone: true }),
    secure: t.boolean().notNull().default(false),
    httpOnly: t.boolean().notNull().default(false),
    sameSite: t.varchar({ length: 10 }).notNull().default("Lax"),
    source: t.varchar({ length: 20 }).notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("browser_cookies_user_domain_name_path_idx").on(
      table.userId,
      table.domain,
      table.name,
      table.path,
    ),
    index("browser_cookies_user_domain_idx").on(table.userId, table.domain),
  ],
);

export const sessionCookieScopes = pgTable(
  "session_cookie_scopes",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("session_cookie_scopes_session_domain_idx").on(
      table.sessionId,
      table.domain,
    ),
  ],
);

export const sessionSecrets = pgTable(
  "session_secrets",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .references(() => workspaces.id, { onDelete: "set null" }),
    projectId: t
      .uuid()
      .references(() => projects.id, { onDelete: "set null" }),
    label: t.varchar({ length: 128 }).notNull(),
    handle: t.varchar({ length: 64 }).notNull(),
    transport: t.varchar({ length: 32 }).notNull().default("template"),
    source: t.varchar({ length: 32 }).notNull().default("pasted"),
    provider: t.varchar({ length: 32 }).notNull().default("bob"),
    status: t.varchar({ length: 20 }).notNull().default("active"),
    valueCiphertext: t.text(),
    valueIv: t.text(),
    valueTag: t.text(),
    policy: t
      .jsonb()
      .$type<{
        allowedTemplates?: string[];
        redactOutput?: boolean;
        maxUses?: number | null;
        templatePolicies?: Record<
          string,
          {
            allowedArgPrefixes?: Record<string, string[]>;
          }
        >;
      }>()
      .notNull()
      .default({}),
    externalRef: t.text(),
    expiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastUsedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("session_secrets_session_idx").on(table.sessionId),
    index("session_secrets_project_idx").on(table.projectId),
    uniqueIndex("session_secrets_session_handle_idx").on(
      table.sessionId,
      table.handle,
    ),
  ],
);

export const sessionSecretUsages = pgTable(
  "session_secret_usages",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    secretId: t
      .uuid()
      .notNull()
      .references(() => sessionSecrets.id, { onDelete: "cascade" }),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    executor: t.varchar({ length: 32 }).notNull(),
    templateId: t.varchar({ length: 64 }),
    commandPreview: t.text(),
    exitCode: t.integer(),
    durationMs: t.integer(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("session_secret_usages_secret_idx").on(table.secretId),
    index("session_secret_usages_session_idx").on(table.sessionId),
  ],
);

export const projectDeploySecretBindings = pgTable(
  "project_deploy_secret_bindings",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    projectId: t
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    label: t.varchar({ length: 128 }).notNull(),
    forgegraphKey: t.varchar({ length: 128 }).notNull(),
    externalRef: t.text().notNull(),
    transport: t.varchar({ length: 32 }).notNull().default("template"),
    templateId: t.varchar({ length: 64 }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("project_deploy_secret_bindings_env_key_idx").on(
      table.projectId,
      table.environment,
      table.forgegraphKey,
    ),
  ],
);

// pullRequests / CreatePullRequestSchema / prReviews / featureBranches /
// featureBranchTaskPRs / gitCommits / CreateGitCommitSchema moved to
// @bob/git/schema (Phase 7B-2 Task 15).

// webhookConfigs / CreateWebhookConfigSchema / webhookDeliveries /
// CreateWebhookDeliverySchema moved to @bob/webhooks/schema (Phase 7B-2 Task 16).

// taskRuns / CreateTaskRunSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// comments / CreateCommentSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

export const activities = pgTable("activities", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  userId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemActivityTypeEnum().notNull(),
  fromValue: t.text(),
  toValue: t.text(),
  metadata: t.json().$type<Record<string, unknown>>(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

// workItemArtifacts / CreateWorkItemArtifactSchema moved to @bob/work-items/schema (Phase 7B-2 Task 12).

export const notifications = pgTable("notifications", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workItemId: t
    .uuid()
    .references(() => workItems.id, { onDelete: "cascade" }),
  actorId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemNotificationTypeEnum().notNull(),
  title: t.text().notNull(),
  body: t.text(),
  url: t.text(),
  read: t.boolean().notNull().default(false),
  readAt: t.timestamp({ mode: "string", withTimezone: true }),
  archivedAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateNotificationSchema = createInsertSchema(notifications, {
  type: z.enum(workItemNotificationType),
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  url: z.string().url().optional(),
}).omit({
  id: true,
  read: true,
  readAt: true,
  archivedAt: true,
  createdAt: true,
});

// 6.1a Device Push Tokens (for mobile notifications)
export const devicePushTokens = pgTable("device_push_tokens", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceType: t.varchar({ length: 20 }).notNull(), // 'ios' | 'android' | 'web'
  expoPushToken: t.text().notNull(),
  deviceName: t.text(),
  enabled: t.boolean().notNull().default(true),
  lastSeenAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateDevicePushTokenSchema = createInsertSchema(
  devicePushTokens,
  {
    deviceType: z.enum(["ios", "android", "web"]),
    expoPushToken: z.string(),
    deviceName: z.string().optional(),
    enabled: z.boolean().default(true),
  },
).omit({
  id: true,
  userId: true,
  createdAt: true,
  lastSeenAt: true,
});

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

export const activitiesRelations = relations(activities, ({ one }) => ({
  workItem: one(workItems, {
    fields: [activities.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [activities.userId],
    references: [user.id],
  }),
}));

// workItemArtifactsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
  workItem: one(workItems, {
    fields: [notifications.workItemId],
    references: [workItems.id],
  }),
  actor: one(user, {
    fields: [notifications.actorId],
    references: [user.id],
  }),
}));

export const devicePushTokensRelations = relations(
  devicePushTokens,
  ({ one }) => ({
    user: one(user, {
      fields: [devicePushTokens.userId],
      references: [user.id],
    }),
  }),
);

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

// ── Browser Cookie Jar Relations ───────────────────────────────────

export const browserCookiesRelations = relations(browserCookies, ({ one }) => ({
  user: one(user, {
    fields: [browserCookies.userId],
    references: [user.id],
  }),
}));

export const sessionCookieScopesRelations = relations(
  sessionCookieScopes,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [sessionCookieScopes.sessionId],
      references: [chatConversations.id],
    }),
  }),
);

export const sessionSecretsRelations = relations(sessionSecrets, ({ one, many }) => ({
  user: one(user, {
    fields: [sessionSecrets.userId],
    references: [user.id],
  }),
  session: one(chatConversations, {
    fields: [sessionSecrets.sessionId],
    references: [chatConversations.id],
  }),
  workspace: one(workspaces, {
    fields: [sessionSecrets.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [sessionSecrets.projectId],
    references: [projects.id],
  }),
  usages: many(sessionSecretUsages),
}));

export const sessionSecretUsagesRelations = relations(
  sessionSecretUsages,
  ({ one }) => ({
    secret: one(sessionSecrets, {
      fields: [sessionSecretUsages.secretId],
      references: [sessionSecrets.id],
    }),
    session: one(chatConversations, {
      fields: [sessionSecretUsages.sessionId],
      references: [chatConversations.id],
    }),
  }),
);

export const projectDeploySecretBindingsRelations = relations(
  projectDeploySecretBindings,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDeploySecretBindings.projectId],
      references: [projects.id],
    }),
  }),
);

// sessionEventsRelations / sessionConnectionsRelations /
// sessionCheckpointsRelations moved to @bob/agents/schema (Phase 7B-2 Task 14,
// now that chatConversations lives in @bob/chat/schema).

