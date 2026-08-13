"use strict";
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
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitCommitsRelations = exports.featureBranchTaskPRsRelations = exports.featureBranchesRelations = exports.prReviewsRelations = exports.pullRequestsRelations = exports.gitProviderConnectionsRelations = exports.CreateGitCommitSchema = exports.gitCommits = exports.featureBranchTaskPRs = exports.featureBranches = exports.prReviews = exports.CreatePullRequestSchema = exports.pullRequests = exports.CreateGitProviderConnectionSchema = exports.gitProviderConnections = exports.webhookStatusEnum = exports.prReviewStatusPgEnum = exports.prReviewStatusEnum = exports.prStatusEnum = exports.gitProviderEnum = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
var projects_js_1 = require("./projects.js");
var work_items_js_1 = require("./work-items.js");
var chat_js_1 = require("./chat.js");
// =============================================================================
// Const-array enums
// =============================================================================
exports.gitProviderEnum = ["github", "gitlab", "gitea"];
exports.prStatusEnum = ["draft", "open", "merged", "closed"];
exports.prReviewStatusEnum = [
    "approved",
    "changes_requested",
    "commented",
];
exports.prReviewStatusPgEnum = (0, pg_core_1.pgEnum)("pr_review_status", exports.prReviewStatusEnum);
exports.webhookStatusEnum = ["pending", "processed", "failed"];
// =============================================================================
// Tables
// =============================================================================
// 1.1 Git Provider Connections (encrypted tokens)
exports.gitProviderConnections = (0, pg_core_1.pgTable)("git_provider_connections", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
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
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateGitProviderConnectionSchema = (0, drizzle_zod_1.createInsertSchema)(exports.gitProviderConnections, {
    provider: v4_1.z.enum(exports.gitProviderEnum),
    instanceUrl: v4_1.z.string().url().optional(),
    providerAccountId: v4_1.z.string(),
    providerUsername: v4_1.z.string().optional(),
    scopes: v4_1.z.string().optional(),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    revokedAt: true,
});
// 1.2 Pull Requests
exports.pullRequests = (0, pg_core_1.pgTable)("pull_requests", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "set null" }),
    gitProviderConnectionId: t
        .uuid()
        .references(function () { return exports.gitProviderConnections.id; }, { onDelete: "set null" }),
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
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "set null" }),
    planningTaskId: t.text("kanbanger_task_id"),
    additions: t.integer(),
    deletions: t.integer(),
    changedFiles: t.integer(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["now()"], ["now()"]))); }),
    mergedAt: t.timestamp({ mode: "string", withTimezone: true }),
    closedAt: t.timestamp({ mode: "string", withTimezone: true }),
}); });
exports.CreatePullRequestSchema = (0, drizzle_zod_1.createInsertSchema)(exports.pullRequests, {
    provider: v4_1.z.enum(exports.gitProviderEnum),
    instanceUrl: v4_1.z.string().url().optional(),
    remoteOwner: v4_1.z.string(),
    remoteName: v4_1.z.string(),
    number: v4_1.z.number().int().positive(),
    headBranch: v4_1.z.string(),
    baseBranch: v4_1.z.string(),
    title: v4_1.z.string(),
    body: v4_1.z.string().optional(),
    status: v4_1.z.enum(exports.prStatusEnum),
    url: v4_1.z.string().url(),
    planningTaskId: v4_1.z.string().optional(),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    mergedAt: true,
    closedAt: true,
});
// 1.2.1 PR Reviews
exports.prReviews = (0, pg_core_1.pgTable)("pr_reviews", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    pullRequestId: t
        .uuid()
        .notNull()
        .references(function () { return exports.pullRequests.id; }, { onDelete: "cascade" }),
    userId: t.text().notNull(),
    status: (0, exports.prReviewStatusPgEnum)().notNull(),
    body: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("pr_reviews_pull_request_id_idx").on(table.pullRequestId),
]; });
// 1.2.2 Feature Branches
exports.featureBranches = (0, pg_core_1.pgTable)("feature_branches", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return work_items_js_1.workItems.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    branchName: t.text().notNull(),
    baseBranch: t.text().notNull().default("main"),
    status: t.text().notNull().default("active"), // 'active' | 'ready' | 'merged' | 'abandoned'
    featurePrId: t
        .uuid()
        .references(function () { return exports.pullRequests.id; }, { onDelete: "set null" }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("feature_branches_work_item_id_idx").on(table.workItemId),
    (0, pg_core_1.index)("feature_branches_repository_id_idx").on(table.repositoryId),
]; });
// 1.2.3 Feature Branch Task PRs (junction table)
exports.featureBranchTaskPRs = (0, pg_core_1.pgTable)("feature_branch_task_prs", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    featureBranchId: t
        .uuid()
        .notNull()
        .references(function () { return exports.featureBranches.id; }, { onDelete: "cascade" }),
    pullRequestId: t
        .uuid()
        .notNull()
        .references(function () { return exports.pullRequests.id; }, { onDelete: "cascade" }),
    mergedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("feature_branch_task_prs_feature_branch_id_idx").on(table.featureBranchId),
    (0, pg_core_1.index)("feature_branch_task_prs_pull_request_id_idx").on(table.pullRequestId),
]; });
// 1.3 Git Commits
exports.gitCommits = (0, pg_core_1.pgTable)("git_commits", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repositoryId: t
        .uuid()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "set null" }),
    pullRequestId: t
        .uuid()
        .references(function () { return exports.pullRequests.id; }, { onDelete: "set null" }),
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
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "set null" }),
    isBobCommit: t.boolean().notNull().default(false),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.CreateGitCommitSchema = (0, drizzle_zod_1.createInsertSchema)(exports.gitCommits, {
    provider: v4_1.z.enum(exports.gitProviderEnum),
    instanceUrl: v4_1.z.string().url().optional(),
    remoteOwner: v4_1.z.string(),
    remoteName: v4_1.z.string(),
    sha: v4_1.z.string().length(40),
    message: v4_1.z.string(),
    authorName: v4_1.z.string().optional(),
    authorEmail: v4_1.z.string().email().optional(),
    isBobCommit: v4_1.z.boolean().default(false),
}).omit({
    id: true,
    createdAt: true,
});
// =============================================================================
// Relations
// =============================================================================
exports.gitProviderConnectionsRelations = (0, drizzle_orm_1.relations)(exports.gitProviderConnections, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.gitProviderConnections.userId],
            references: [auth_js_1.user.id],
        }),
        pullRequests: many(exports.pullRequests),
    });
});
exports.pullRequestsRelations = (0, drizzle_orm_1.relations)(exports.pullRequests, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.pullRequests.userId],
            references: [auth_js_1.user.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.pullRequests.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        gitProviderConnection: one(exports.gitProviderConnections, {
            fields: [exports.pullRequests.gitProviderConnectionId],
            references: [exports.gitProviderConnections.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.pullRequests.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
        commits: many(exports.gitCommits),
        taskRuns: many(work_items_js_1.taskRuns),
        reviews: many(exports.prReviews),
        featureBranchTaskPRs: many(exports.featureBranchTaskPRs),
    });
});
exports.prReviewsRelations = (0, drizzle_orm_1.relations)(exports.prReviews, function (_a) {
    var one = _a.one;
    return ({
        pullRequest: one(exports.pullRequests, {
            fields: [exports.prReviews.pullRequestId],
            references: [exports.pullRequests.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.prReviews.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.featureBranchesRelations = (0, drizzle_orm_1.relations)(exports.featureBranches, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.featureBranches.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.featureBranches.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        featurePr: one(exports.pullRequests, {
            fields: [exports.featureBranches.featurePrId],
            references: [exports.pullRequests.id],
        }),
        taskPRs: many(exports.featureBranchTaskPRs),
    });
});
exports.featureBranchTaskPRsRelations = (0, drizzle_orm_1.relations)(exports.featureBranchTaskPRs, function (_a) {
    var one = _a.one;
    return ({
        featureBranch: one(exports.featureBranches, {
            fields: [exports.featureBranchTaskPRs.featureBranchId],
            references: [exports.featureBranches.id],
        }),
        pullRequest: one(exports.pullRequests, {
            fields: [exports.featureBranchTaskPRs.pullRequestId],
            references: [exports.pullRequests.id],
        }),
    });
});
exports.gitCommitsRelations = (0, drizzle_orm_1.relations)(exports.gitCommits, function (_a) {
    var one = _a.one;
    return ({
        repository: one(projects_js_1.repositories, {
            fields: [exports.gitCommits.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        pullRequest: one(exports.pullRequests, {
            fields: [exports.gitCommits.pullRequestId],
            references: [exports.pullRequests.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.gitCommits.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
var templateObject_1, templateObject_2;
