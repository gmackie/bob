"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.forgeRunEventsRelations = exports.forgeDeploymentsRelations = exports.forgeBuildsRelations = exports.forgeRevisionsRelations = exports.forgeRunEvents = exports.forgeRunEventTypeEnum = exports.forgeDeployments = exports.forgeDeploymentStatusEnum = exports.forgeDeploymentEnvEnum = exports.forgeBuilds = exports.forgeBuildStatusEnum = exports.forgeRevisions = exports.forgeRevisionStatusEnum = void 0;
// CI/forge tables — moved from @bob/db/schema (Phase 7B-2 Task 17).
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var projects_js_1 = require("./projects.js");
var work_items_js_1 = require("./work-items.js");
// =============================================================================
// ForgeGraph Tables (revisions, builds, deployments, run events)
// =============================================================================
exports.forgeRevisionStatusEnum = ["open", "merged", "abandoned"];
exports.forgeRevisions = (0, pg_core_1.pgTable)("forge_revisions", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repoId: t.uuid().notNull().references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    revId: t.text().notNull(), // commit SHA or JJ changeset ID
    taskId: t.uuid().references(function () { return work_items_js_1.workItems.id; }, { onDelete: "set null" }),
    taskRunId: t.uuid().references(function () { return work_items_js_1.taskRuns.id; }, { onDelete: "set null" }),
    branch: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("open"),
    gates: t.json().$type().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ withTimezone: true }).$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    { name: "forge_revisions_repo_idx", columns: [table.repoId] },
    { name: "forge_revisions_task_idx", columns: [table.taskId] },
    { name: "forge_revisions_repo_rev_idx", columns: [table.repoId, table.revId], unique: true },
]; });
exports.forgeBuildStatusEnum = ["queued", "running", "passed", "failed", "canceled", "superseded"];
exports.forgeBuilds = (0, pg_core_1.pgTable)("forge_builds", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(function () { return exports.forgeRevisions.id; }, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
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
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    { name: "forge_builds_revision_idx", columns: [table.revisionId] },
    { name: "forge_builds_idempotency_idx", columns: [table.idempotencyKey], unique: true },
]; });
exports.forgeDeploymentEnvEnum = ["dev", "staging", "prod", "preview"];
exports.forgeDeploymentStatusEnum = ["pending_approval", "deploying", "healthy", "unhealthy", "rolled_back", "failed"];
exports.forgeDeployments = (0, pg_core_1.pgTable)("forge_deployments", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(function () { return exports.forgeRevisions.id; }, { onDelete: "cascade" }),
    buildId: t.uuid().notNull().references(function () { return exports.forgeBuilds.id; }, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    status: t.varchar({ length: 30 }).notNull().default("pending_approval"),
    rollbackTargetId: t.uuid(), // self-ref to another forgeDeployments.id
    deployedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_3 || (templateObject_3 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    { name: "forge_deployments_revision_idx", columns: [table.revisionId] },
    { name: "forge_deployments_env_idx", columns: [table.repoId, table.environment] },
]; });
exports.forgeRunEventTypeEnum = ["created", "patch_applied", "tests_started", "tests_finished", "approved", "integrated", "failed"];
exports.forgeRunEvents = (0, pg_core_1.pgTable)("forge_run_events", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t.text().notNull(), // Bob taskRunId
    repoId: t.uuid().notNull().references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    revisionId: t.uuid().notNull().references(function () { return exports.forgeRevisions.id; }, { onDelete: "cascade" }),
    taskId: t.uuid().references(function () { return work_items_js_1.workItems.id; }, { onDelete: "set null" }),
    agentId: t.uuid(), // chatConversation session ID
    eventType: t.varchar({ length: 30 }).notNull(),
    testStatus: t.text(),
    artifactRefs: t.json().$type().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    { name: "forge_run_events_run_idx", columns: [table.runId] },
    { name: "forge_run_events_revision_idx", columns: [table.revisionId] },
]; });
// ForgeGraph Relations
exports.forgeRevisionsRelations = (0, drizzle_orm_1.relations)(exports.forgeRevisions, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        repository: one(projects_js_1.repositories, {
            fields: [exports.forgeRevisions.repoId],
            references: [projects_js_1.repositories.id],
        }),
        task: one(work_items_js_1.workItems, {
            fields: [exports.forgeRevisions.taskId],
            references: [work_items_js_1.workItems.id],
        }),
        taskRun: one(work_items_js_1.taskRuns, {
            fields: [exports.forgeRevisions.taskRunId],
            references: [work_items_js_1.taskRuns.id],
        }),
        builds: many(exports.forgeBuilds),
        deployments: many(exports.forgeDeployments),
        runEvents: many(exports.forgeRunEvents),
    });
});
exports.forgeBuildsRelations = (0, drizzle_orm_1.relations)(exports.forgeBuilds, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        revision: one(exports.forgeRevisions, {
            fields: [exports.forgeBuilds.revisionId],
            references: [exports.forgeRevisions.id],
        }),
        deployments: many(exports.forgeDeployments),
    });
});
exports.forgeDeploymentsRelations = (0, drizzle_orm_1.relations)(exports.forgeDeployments, function (_a) {
    var one = _a.one;
    return ({
        revision: one(exports.forgeRevisions, {
            fields: [exports.forgeDeployments.revisionId],
            references: [exports.forgeRevisions.id],
        }),
        build: one(exports.forgeBuilds, {
            fields: [exports.forgeDeployments.buildId],
            references: [exports.forgeBuilds.id],
        }),
    });
});
exports.forgeRunEventsRelations = (0, drizzle_orm_1.relations)(exports.forgeRunEvents, function (_a) {
    var one = _a.one;
    return ({
        revision: one(exports.forgeRevisions, {
            fields: [exports.forgeRunEvents.revisionId],
            references: [exports.forgeRevisions.id],
        }),
    });
});
var templateObject_1, templateObject_2, templateObject_3;
