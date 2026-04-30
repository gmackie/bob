// =============================================================================
// @bob/git/schema — Git-area tables (Phase 7B-2 Task 15)
//
// Moved verbatim from packages/bob/src/db/src/schema.ts. Six tables:
//   gitProviderConnections, pullRequests, prReviews, featureBranches,
//   featureBranchTaskPRs, gitCommits
//
// Cross-area imports:
//   - user from @bob/auth/schema
//   - repositories from @bob/projects/schema
//   - workItems, taskRuns from @bob/work-items/schema
//   - chatConversations from @bob/chat/schema
// =============================================================================

import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";
import { repositories } from "@bob/projects/schema";
import { taskRuns, workItems } from "@bob/work-items/schema";
import { chatConversations } from "@bob/chat/schema";

// =============================================================================
// Const-array enums
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

// =============================================================================
// Tables
// =============================================================================

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

// =============================================================================
// Relations
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
