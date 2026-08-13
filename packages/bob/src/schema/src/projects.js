"use strict";
// =============================================================================
// @bob/projects/schema — Projects + repository discovery + worktree planning
// tables.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 11):
//   - projects
//   - repositories
//   - discoveredDirs
//   - worktrees
//   - worktreePlans
//   - worktreeLinks
//
// Note: agentTypeEnum / instanceStatusEnum live here because the projects-area
// CreateWorktreeSchema needs agentTypeEnum. They are agents-domain values; if
// Task 13 (agents move) decides to relocate them to @bob/agents/schema, the
// monolith re-export keeps every existing import site working.
// =============================================================================
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.worktreeLinksRelations = exports.worktreePlansRelations = exports.worktreesRelations = exports.workspaceIntegrationsRelations = exports.projectsRelations = exports.repositoriesRelations = exports.CreateWorktreeLinkSchema = exports.worktreeLinks = exports.CreateWorktreePlanSchema = exports.worktreePlans = exports.CreateWorktreeSchema = exports.worktrees = exports.CreateRepositorySchema = exports.discoveredDirs = exports.repositories = exports.CreateProjectSchema = exports.workspaceIntegrations = exports.projects = exports.linkTypeEnum = exports.planStatusEnum = exports.instanceStatusEnum = exports.agentTypeEnum = exports.projectStatusEnum = exports.projectStatus = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var agents_js_1 = require("./agents.js");
var auth_js_1 = require("./auth.js");
var tenancy_js_1 = require("./tenancy.js");
var work_items_js_1 = require("./work-items.js");
// --- Project status enum ---
exports.projectStatus = [
    "planned",
    "active",
    "in_progress",
    "paused",
    "completed",
    "archived",
];
exports.projectStatusEnum = (0, pg_core_1.pgEnum)("project_status", exports.projectStatus);
// --- Agent type / instance status (used by CreateWorktreeSchema below) ---
exports.agentTypeEnum = [
    "claude",
    "kiro",
    "codex",
    "gemini",
    "grok",
    "opencode",
    "smol-agent",
    "cursor-agent",
    "elevenlabs",
];
exports.instanceStatusEnum = [
    "running",
    "stopped",
    "starting",
    "error",
];
// --- Worktree plan / link enums ---
exports.planStatusEnum = [
    "draft",
    "active",
    "completed",
    "archived",
];
exports.linkTypeEnum = [
    "planning_task",
    "github_pr",
    "github_issue",
    "control_panel",
    "external",
];
// --- Tables ---
exports.projects = (0, pg_core_1.pgTable)("projects", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
        .uuid()
        .notNull()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    leadUserId: t.text().references(function () { return auth_js_1.user.id; }, { onDelete: "set null" }),
    forgeGraphAppId: t.text().unique(), // 1:1 with ForgeGraph app
    repoUrl: t.text(), // synced from ForgeGraph
    defaultBranch: t.text(), // synced from ForgeGraph
    name: t.varchar({ length: 128 }).notNull(),
    key: t.varchar({ length: 16 }).notNull(),
    description: t.text(),
    color: t.varchar({ length: 7 }),
    status: (0, exports.projectStatusEnum)().notNull().default("planned"),
    automationSettings: t
        .jsonb()
        .$type()
        .notNull()
        .default({}),
    planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
    // Default agent for this project's work items; overrides the workspace
    // default, overridden by a per-work-item agentTypeOverride. Nullable = unset.
    defaultAgentType: t.varchar({ length: 50 }),
    linearProjectId: t.text(),
    // Durable source identity for approved cross-system intake. OODA supplies
    // an immutable delivery key; the unique index makes retries collapse at the
    // destination even if the caller timed out after Bob committed.
    externalProvider: t.varchar({ length: 32 }),
    externalId: t.text(),
    sourceMetadata: t
        .jsonb()
        .$type()
        .notNull()
        .default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("projects_external_provider_id_uidx")
        .on(table.externalProvider, table.externalId)
        .where((0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["", " is not null and ", " is not null"], ["", " is not null and ", " is not null"])), table.externalProvider, table.externalId)),
]; });
exports.workspaceIntegrations = (0, pg_core_1.pgTable)("workspace_integrations", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
        .uuid()
        .notNull()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    provider: t.varchar({ length: 20 }).notNull(),
    enabled: t.boolean().notNull().default(true),
    apiKey: t.text(),
    webhookSigningSecret: t.text(),
    linearTeamId: t.text(),
    linearWebBaseUrl: t.text(),
    /**
     * GraphQL endpoint for this integration. NULL uses the @linear/sdk default
     * (api.linear.app); set it to drive a Linear-API-compatible instance such
     * as Kanbanger (https://tasks.gmac.io/graphql) instead.
     */
    linearApiUrl: t.text(),
    // Sync-health: when this integration last synced + a one-line outcome, so
    // it's visible in-app instead of only in cron console logs.
    lastSyncedAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastSyncResult: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_3 || (templateObject_3 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    {
        name: "workspace_integrations_workspace_provider_idx",
        columns: [table.workspaceId, table.provider],
        unique: true,
    },
]; });
exports.CreateProjectSchema = (0, drizzle_zod_1.createInsertSchema)(exports.projects, {
    name: v4_1.z.string().min(1).max(128),
    key: v4_1.z
        .string()
        .min(2)
        .max(16)
        .regex(/^[A-Z][A-Z0-9]*$/),
    status: v4_1.z.enum(exports.projectStatus).default("planned"),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
exports.repositories = (0, pg_core_1.pgTable)("repositories", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    planningProjectId: t.text("kanbanger_project_id"),
    name: t.varchar({ length: 256 }).notNull(),
    path: t.text().notNull(),
    branch: t.varchar({ length: 256 }).notNull(),
    mainBranch: t.varchar({ length: 256 }).notNull().default("main"),
    remoteUrl: t.text(),
    remoteProvider: t.varchar({ length: 20 }),
    remoteOwner: t.text(),
    remoteName: t.text(),
    remoteInstanceUrl: t.text(),
    gitProviderConnectionId: t.uuid(),
    workspaceId: t
        .uuid("workspace_id")
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    buildSystem: t.varchar("build_system", { length: 32 }),
    dirty: t.boolean().default(false),
    stale: t.boolean().default(false),
    discoveryStatus: t
        .varchar("discovery_status", { length: 16 })
        .default("discovered"),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_4 || (templateObject_4 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.discoveredDirs = (0, pg_core_1.pgTable)("discovered_dirs", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
        .uuid("workspace_id")
        .notNull()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    path: t.text().notNull(),
    name: t.varchar({ length: 256 }).notNull(),
    dismissed: t.boolean().default(false),
    lastSeen: t.timestamp("last_seen", { mode: "string" }).defaultNow(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.CreateRepositorySchema = (0, drizzle_zod_1.createInsertSchema)(exports.repositories, {
    name: v4_1.z.string().max(256),
    path: v4_1.z.string(),
    branch: v4_1.z.string().max(256),
    mainBranch: v4_1.z.string().max(256).default("main"),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
});
exports.worktrees = (0, pg_core_1.pgTable)("worktrees", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .notNull()
        .references(function () { return exports.repositories.id; }, { onDelete: "cascade" }),
    path: t.text().notNull(),
    branch: t.varchar({ length: 256 }).notNull(),
    preferredAgent: t.varchar({ length: 50 }).notNull().default("claude"),
    isMainWorktree: t.boolean().notNull().default(false),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_5 || (templateObject_5 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateWorktreeSchema = (0, drizzle_zod_1.createInsertSchema)(exports.worktrees, {
    path: v4_1.z.string(),
    branch: v4_1.z.string().max(256),
    preferredAgent: v4_1.z.enum(exports.agentTypeEnum).default("claude"),
    isMainWorktree: v4_1.z.boolean().default(false),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
});
exports.worktreePlans = (0, pg_core_1.pgTable)("worktree_plans", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    worktreeId: t
        .uuid()
        .notNull()
        .references(function () { return exports.worktrees.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    filePath: t.text().notNull(),
    title: t.varchar({ length: 256 }),
    goal: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("draft"),
    planningTaskId: t.varchar("kanbanger_task_id", { length: 100 }),
    lastSyncedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_6 || (templateObject_6 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateWorktreePlanSchema = (0, drizzle_zod_1.createInsertSchema)(exports.worktreePlans, {
    filePath: v4_1.z.string(),
    title: v4_1.z.string().max(256).optional(),
    goal: v4_1.z.string().optional(),
    status: v4_1.z.enum(exports.planStatusEnum).default("draft"),
    planningTaskId: v4_1.z.string().max(100).optional(),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    lastSyncedAt: true,
});
exports.worktreeLinks = (0, pg_core_1.pgTable)("worktree_links", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    worktreeId: t
        .uuid()
        .notNull()
        .references(function () { return exports.worktrees.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    linkType: t.varchar({ length: 50 }).notNull(),
    externalId: t.varchar({ length: 256 }),
    url: t.text(),
    title: t.varchar({ length: 256 }),
    metadata: t.json().$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_7 || (templateObject_7 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateWorktreeLinkSchema = (0, drizzle_zod_1.createInsertSchema)(exports.worktreeLinks, {
    linkType: v4_1.z.enum(exports.linkTypeEnum),
    externalId: v4_1.z.string().max(256).optional(),
    url: v4_1.z.string().url().optional(),
    title: v4_1.z.string().max(256).optional(),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
});
// --- Relations ---
exports.repositoriesRelations = (0, drizzle_orm_1.relations)(exports.repositories, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.repositories.userId],
            references: [auth_js_1.user.id],
        }),
        worktrees: many(exports.worktrees),
        instances: many(agents_js_1.agentInstances),
    });
});
exports.projectsRelations = (0, drizzle_orm_1.relations)(exports.projects, function (_a) {
    var one = _a.one;
    return ({
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.projects.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
        leadUser: one(auth_js_1.user, {
            fields: [exports.projects.leadUserId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.workspaceIntegrationsRelations = (0, drizzle_orm_1.relations)(exports.workspaceIntegrations, function (_a) {
    var one = _a.one;
    return ({
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.workspaceIntegrations.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
    });
});
exports.worktreesRelations = (0, drizzle_orm_1.relations)(exports.worktrees, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.worktrees.userId],
            references: [auth_js_1.user.id],
        }),
        repository: one(exports.repositories, {
            fields: [exports.worktrees.repositoryId],
            references: [exports.repositories.id],
        }),
        instances: many(agents_js_1.agentInstances),
    });
});
exports.worktreePlansRelations = (0, drizzle_orm_1.relations)(exports.worktreePlans, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        worktree: one(exports.worktrees, {
            fields: [exports.worktreePlans.worktreeId],
            references: [exports.worktrees.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.worktreePlans.userId],
            references: [auth_js_1.user.id],
        }),
        tasks: many(work_items_js_1.planTaskItems),
    });
});
exports.worktreeLinksRelations = (0, drizzle_orm_1.relations)(exports.worktreeLinks, function (_a) {
    var one = _a.one;
    return ({
        worktree: one(exports.worktrees, {
            fields: [exports.worktreeLinks.worktreeId],
            references: [exports.worktrees.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.worktreeLinks.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5, templateObject_6, templateObject_7;
