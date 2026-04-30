import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
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
  taskRuns,
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

// =============================================================================
// GitHub Integration Tables (Phase 1)
// =============================================================================

export const gitProviderEnum = ["github", "gitlab", "gitea"] as const;
export type GitProvider = (typeof gitProviderEnum)[number];

export const prStatusEnum = ["draft", "open", "merged", "closed"] as const;
export type PRStatus = (typeof prStatusEnum)[number];

export const prReviewStatusEnum = [
  "approved",
  "changes_requested",
  "commented",
] as const;
export type PRReviewStatus = (typeof prReviewStatusEnum)[number];
export const prReviewStatusPgEnum = pgEnum(
  "pr_review_status",
  prReviewStatusEnum,
);

export const webhookStatusEnum = ["pending", "processed", "failed"] as const;
export type WebhookStatus = (typeof webhookStatusEnum)[number];

// taskRunStatusEnum / TaskRunStatus moved to @bob/work-items/schema (Phase 7B-2 Task 12).

// 1.1 Git Provider Connections (encrypted tokens)
export const gitProviderConnections = pgTable(
  "git_provider_connections",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea'
    instanceUrl: t.text(), // null for github.com/gitlab.com, set for self-hosted
    providerAccountId: t.text().notNull(),
    providerUsername: t.text(),
    scopes: t.text(),
    // Encrypted token fields (AES-256-GCM)
    accessTokenCiphertext: t.text().notNull(),
    accessTokenIv: t.text().notNull(),
    accessTokenTag: t.text().notNull(),
    refreshTokenCiphertext: t.text(),
    refreshTokenIv: t.text(),
    refreshTokenTag: t.text(),
    accessTokenExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    refreshTokenExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    revokedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
);

export const CreateGitProviderConnectionSchema = createInsertSchema(
  gitProviderConnections,
  {
    provider: z.enum(gitProviderEnum),
    instanceUrl: z.string().url().optional(),
    providerAccountId: z.string(),
    providerUsername: z.string().optional(),
    scopes: z.string().optional(),
  },
).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
});

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

// 1.2 Pull Requests
export const pullRequests = pgTable("pull_requests", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  gitProviderConnectionId: t
    .uuid()
    .references(() => gitProviderConnections.id, { onDelete: "set null" }),
  provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea'
  instanceUrl: t.text(), // null for github.com/gitlab.com
  remoteOwner: t.text().notNull(),
  remoteName: t.text().notNull(),
  number: t.integer().notNull(),
  headBranch: t.text().notNull(),
  baseBranch: t.text().notNull(),
  title: t.text().notNull(),
  body: t.text(),
  status: t.varchar({ length: 20 }).notNull(), // 'draft' | 'open' | 'merged' | 'closed'
  url: t.text().notNull(),
  sessionId: t
    .uuid()
    .references(() => chatConversations.id, { onDelete: "set null" }),
  planningTaskId: t.text("kanbanger_task_id"),
  additions: t.integer(),
  deletions: t.integer(),
  changedFiles: t.integer(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  mergedAt: t.timestamp({ mode: "string", withTimezone: true }),
  closedAt: t.timestamp({ mode: "string", withTimezone: true }),
}));

export const CreatePullRequestSchema = createInsertSchema(pullRequests, {
  provider: z.enum(gitProviderEnum),
  instanceUrl: z.string().url().optional(),
  remoteOwner: z.string(),
  remoteName: z.string(),
  number: z.number().int().positive(),
  headBranch: z.string(),
  baseBranch: z.string(),
  title: z.string(),
  body: z.string().optional(),
  status: z.enum(prStatusEnum),
  url: z.string().url(),
  planningTaskId: z.string().optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  mergedAt: true,
  closedAt: true,
});

// 1.2.1 PR Reviews
export const prReviews = pgTable("pr_reviews", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  pullRequestId: t
    .uuid()
    .notNull()
    .references(() => pullRequests.id, { onDelete: "cascade" }),
  userId: t.text().notNull(),
  status: prReviewStatusPgEnum().notNull(),
  body: t.text(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}), (table) => [
  index("pr_reviews_pull_request_id_idx").on(table.pullRequestId),
]);

// 1.2.2 Feature Branches
export const featureBranches = pgTable("feature_branches", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  branchName: t.text().notNull(),
  baseBranch: t.text().notNull().default("main"),
  status: t.text().notNull().default("active"), // 'active' | 'ready' | 'merged' | 'abandoned'
  featurePrId: t
    .uuid()
    .references(() => pullRequests.id, { onDelete: "set null" }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}), (table) => [
  index("feature_branches_work_item_id_idx").on(table.workItemId),
  index("feature_branches_repository_id_idx").on(table.repositoryId),
]);

// 1.2.3 Feature Branch Task PRs (junction table)
export const featureBranchTaskPRs = pgTable("feature_branch_task_prs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  featureBranchId: t
    .uuid()
    .notNull()
    .references(() => featureBranches.id, { onDelete: "cascade" }),
  pullRequestId: t
    .uuid()
    .notNull()
    .references(() => pullRequests.id, { onDelete: "cascade" }),
  mergedAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}), (table) => [
  index("feature_branch_task_prs_feature_branch_id_idx").on(table.featureBranchId),
  index("feature_branch_task_prs_pull_request_id_idx").on(table.pullRequestId),
]);

// 1.3 Git Commits
export const gitCommits = pgTable("git_commits", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  pullRequestId: t
    .uuid()
    .references(() => pullRequests.id, { onDelete: "set null" }),
  provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea'
  instanceUrl: t.text(),
  remoteOwner: t.text().notNull(),
  remoteName: t.text().notNull(),
  sha: t.varchar({ length: 40 }).notNull(),
  message: t.text().notNull(),
  authorName: t.text(),
  authorEmail: t.text(),
  committedAt: t.timestamp({ mode: "string", withTimezone: true }).notNull(),
  sessionId: t
    .uuid()
    .references(() => chatConversations.id, { onDelete: "set null" }),
  isBobCommit: t.boolean().notNull().default(false),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateGitCommitSchema = createInsertSchema(gitCommits, {
  provider: z.enum(gitProviderEnum),
  instanceUrl: z.string().url().optional(),
  remoteOwner: z.string(),
  remoteName: z.string(),
  sha: z.string().length(40),
  message: z.string(),
  authorName: z.string().optional(),
  authorEmail: z.string().email().optional(),
  isBobCommit: z.boolean().default(false),
}).omit({
  id: true,
  createdAt: true,
});

// 1.4a Webhook Configs (outbound webhook subscriptions)
export const webhookConfigs = pgTable(
  "webhook_configs",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: t.text().notNull(),
    secret: t.text().notNull(),
    events: t.json().$type<string[]>().notNull().default([]),
    active: t.boolean().notNull().default(true),
    description: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("webhook_configs_user_id_idx").on(table.userId),
    index("webhook_configs_workspace_id_idx").on(table.workspaceId),
  ],
);

export const CreateWebhookConfigSchema = createInsertSchema(webhookConfigs, {
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  description: z.string().max(256).optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

// 1.4b Webhook Deliveries (idempotency + audit)
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    webhookConfigId: t
      .uuid()
      .references(() => webhookConfigs.id, { onDelete: "set null" }),
    provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea' | 'planning'
    deliveryId: t.text(), // X-GitHub-Delivery, X-Gitea-Delivery, etc.
    eventType: t.varchar({ length: 50 }).notNull(), // e.g., 'pull_request', 'push'
    action: t.varchar({ length: 50 }), // e.g., 'opened', 'closed', 'merged'
    signatureValid: t.boolean().notNull(),
    headers: t.json().$type<Record<string, string>>(),
    payload: t.json().$type<Record<string, unknown>>().notNull(),
    status: t.varchar({ length: 20 }).notNull().default("pending"), // 'pending' | 'processed' | 'failed'
    errorMessage: t.text(),
    retryCount: t.integer().notNull().default(0),
    nextRetryAt: t.timestamp({ mode: "string", withTimezone: true }),
    processedAt: t.timestamp({ mode: "string", withTimezone: true }),
    receivedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("webhook_deliveries_config_id_idx").on(table.webhookConfigId),
  ],
);

export const CreateWebhookDeliverySchema = createInsertSchema(
  webhookDeliveries,
  {
    provider: z.string().max(20),
    deliveryId: z.string().optional(),
    eventType: z.string().max(50),
    action: z.string().max(50).optional(),
    signatureValid: z.boolean(),
    status: z.enum(webhookStatusEnum).default("pending"),
  },
).omit({
  id: true,
  receivedAt: true,
  processedAt: true,
});

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

// =============================================================================
// Relations for GitHub Integration Tables
// =============================================================================

export const gitProviderConnectionsRelations = relations(
  gitProviderConnections,
  ({ one, many }) => ({
    user: one(user, {
      fields: [gitProviderConnections.userId],
      references: [user.id],
    }),
    pullRequests: many(pullRequests),
  }),
);

export const pullRequestsRelations = relations(
  pullRequests,
  ({ one, many }) => ({
    user: one(user, {
      fields: [pullRequests.userId],
      references: [user.id],
    }),
    repository: one(repositories, {
      fields: [pullRequests.repositoryId],
      references: [repositories.id],
    }),
    gitProviderConnection: one(gitProviderConnections, {
      fields: [pullRequests.gitProviderConnectionId],
      references: [gitProviderConnections.id],
    }),
    session: one(chatConversations, {
      fields: [pullRequests.sessionId],
      references: [chatConversations.id],
    }),
    commits: many(gitCommits),
    taskRuns: many(taskRuns),
    reviews: many(prReviews),
    featureBranchTaskPRs: many(featureBranchTaskPRs),
  }),
);

export const prReviewsRelations = relations(prReviews, ({ one }) => ({
  pullRequest: one(pullRequests, {
    fields: [prReviews.pullRequestId],
    references: [pullRequests.id],
  }),
  user: one(user, {
    fields: [prReviews.userId],
    references: [user.id],
  }),
}));

export const featureBranchesRelations = relations(
  featureBranches,
  ({ one, many }) => ({
    workItem: one(workItems, {
      fields: [featureBranches.workItemId],
      references: [workItems.id],
    }),
    repository: one(repositories, {
      fields: [featureBranches.repositoryId],
      references: [repositories.id],
    }),
    featurePr: one(pullRequests, {
      fields: [featureBranches.featurePrId],
      references: [pullRequests.id],
    }),
    taskPRs: many(featureBranchTaskPRs),
  }),
);

export const featureBranchTaskPRsRelations = relations(
  featureBranchTaskPRs,
  ({ one }) => ({
    featureBranch: one(featureBranches, {
      fields: [featureBranchTaskPRs.featureBranchId],
      references: [featureBranches.id],
    }),
    pullRequest: one(pullRequests, {
      fields: [featureBranchTaskPRs.pullRequestId],
      references: [pullRequests.id],
    }),
  }),
);

export const gitCommitsRelations = relations(gitCommits, ({ one }) => ({
  repository: one(repositories, {
    fields: [gitCommits.repositoryId],
    references: [repositories.id],
  }),
  pullRequest: one(pullRequests, {
    fields: [gitCommits.pullRequestId],
    references: [pullRequests.id],
  }),
  session: one(chatConversations, {
    fields: [gitCommits.sessionId],
    references: [chatConversations.id],
  }),
}));

// taskRunsRelations moved to @bob/work-items/schema (Phase 7B-2 Task 12).
// `taskRunsRelations.session: one(chatConversations)` is commented out there
// pending Task 14 (chat). `taskRunsRelations.pullRequest: one(pullRequests)`
// is commented out there pending Task 15 (git).

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

export const webhookConfigsRelations = relations(
  webhookConfigs,
  ({ one, many }) => ({
    user: one(user, {
      fields: [webhookConfigs.userId],
      references: [user.id],
    }),
    workspace: one(workspaces, {
      fields: [webhookConfigs.workspaceId],
      references: [workspaces.id],
    }),
    deliveries: many(webhookDeliveries),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhookConfig: one(webhookConfigs, {
      fields: [webhookDeliveries.webhookConfigId],
      references: [webhookConfigs.id],
    }),
  }),
);

// =============================================================================
// ForgeGraph Tables (revisions, builds, deployments, run events)
// =============================================================================

export const forgeRevisionStatusEnum = ["open", "merged", "abandoned"] as const;

export const forgeRevisions = pgTable(
  "forge_revisions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revId: t.text().notNull(), // commit SHA or JJ changeset ID
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    branch: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("open"),
    gates: t.json().$type<Array<{ name: string; status: string; startedAt?: string; finishedAt?: string }>>().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_revisions_repo_idx", columns: [table.repoId] },
    { name: "forge_revisions_task_idx", columns: [table.taskId] },
    { name: "forge_revisions_repo_rev_idx", columns: [table.repoId, table.revId], unique: true },
  ],
);

export const forgeBuildStatusEnum = ["queued", "running", "passed", "failed", "canceled", "superseded"] as const;

export const forgeBuilds = pgTable(
  "forge_builds",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    idempotencyKey: t.text().notNull(),
    ciProvider: t.text(),
    externalJobId: t.text(),
    imageDigest: t.text(),
    artifactManifestRef: t.text(),
    durationMs: t.integer(),
    startedAt: t.timestamp({ mode: "string", withTimezone: true }),
    finishedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_builds_revision_idx", columns: [table.revisionId] },
    { name: "forge_builds_idempotency_idx", columns: [table.idempotencyKey], unique: true },
  ],
);

export const forgeDeploymentEnvEnum = ["dev", "staging", "prod", "preview"] as const;
export const forgeDeploymentStatusEnum = ["pending_approval", "deploying", "healthy", "unhealthy", "rolled_back", "failed"] as const;

export const forgeDeployments = pgTable(
  "forge_deployments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    buildId: t.uuid().notNull().references(() => forgeBuilds.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    status: t.varchar({ length: 30 }).notNull().default("pending_approval"),
    rollbackTargetId: t.uuid(), // self-ref to another forgeDeployments.id
    deployedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_deployments_revision_idx", columns: [table.revisionId] },
    { name: "forge_deployments_env_idx", columns: [table.repoId, table.environment] },
  ],
);

export const forgeRunEventTypeEnum = ["created", "patch_applied", "tests_started", "tests_finished", "approved", "integrated", "failed"] as const;

export const forgeRunEvents = pgTable(
  "forge_run_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t.text().notNull(), // Bob taskRunId
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    agentId: t.uuid(), // chatConversation session ID
    eventType: t.varchar({ length: 30 }).notNull(),
    testStatus: t.text(),
    artifactRefs: t.json().$type<Array<{ type: string; url?: string; description?: string }>>().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    { name: "forge_run_events_run_idx", columns: [table.runId] },
    { name: "forge_run_events_revision_idx", columns: [table.revisionId] },
  ],
);

// ForgeGraph Relations

export const forgeRevisionsRelations = relations(
  forgeRevisions,
  ({ one, many }) => ({
    repository: one(repositories, {
      fields: [forgeRevisions.repoId],
      references: [repositories.id],
    }),
    task: one(workItems, {
      fields: [forgeRevisions.taskId],
      references: [workItems.id],
    }),
    taskRun: one(taskRuns, {
      fields: [forgeRevisions.taskRunId],
      references: [taskRuns.id],
    }),
    builds: many(forgeBuilds),
    deployments: many(forgeDeployments),
    runEvents: many(forgeRunEvents),
  }),
);

export const forgeBuildsRelations = relations(
  forgeBuilds,
  ({ one, many }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeBuilds.revisionId],
      references: [forgeRevisions.id],
    }),
    deployments: many(forgeDeployments),
  }),
);

export const forgeDeploymentsRelations = relations(
  forgeDeployments,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeDeployments.revisionId],
      references: [forgeRevisions.id],
    }),
    build: one(forgeBuilds, {
      fields: [forgeDeployments.buildId],
      references: [forgeBuilds.id],
    }),
  }),
);

export const forgeRunEventsRelations = relations(
  forgeRunEvents,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeRunEvents.revisionId],
      references: [forgeRevisions.id],
    }),
  }),
);


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

