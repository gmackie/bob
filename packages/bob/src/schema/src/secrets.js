"use strict";
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectDeploySecretBindingsRelations = exports.sessionSecretUsagesRelations = exports.sessionSecretsRelations = exports.projectDeploySecretBindings = exports.sessionSecretUsages = exports.sessionSecrets = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var auth_js_1 = require("./auth.js");
var chat_js_1 = require("./chat.js");
var projects_js_1 = require("./projects.js");
var tenancy_js_1 = require("./tenancy.js");
exports.sessionSecrets = (0, pg_core_1.pgTable)("session_secrets", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    workspaceId: t
        .uuid()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "set null" }),
    projectId: t
        .uuid()
        .references(function () { return projects_js_1.projects.id; }, { onDelete: "set null" }),
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
        .$type()
        .notNull()
        .default({}),
    externalRef: t.text(),
    expiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastUsedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.index)("session_secrets_session_idx").on(table.sessionId),
    (0, pg_core_1.index)("session_secrets_project_idx").on(table.projectId),
    (0, pg_core_1.uniqueIndex)("session_secrets_session_handle_idx").on(table.sessionId, table.handle),
]; });
exports.sessionSecretUsages = (0, pg_core_1.pgTable)("session_secret_usages", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    secretId: t
        .uuid()
        .notNull()
        .references(function () { return exports.sessionSecrets.id; }, { onDelete: "cascade" }),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    executor: t.varchar({ length: 32 }).notNull(),
    templateId: t.varchar({ length: 64 }),
    commandPreview: t.text(),
    exitCode: t.integer(),
    durationMs: t.integer(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("session_secret_usages_secret_idx").on(table.secretId),
    (0, pg_core_1.index)("session_secret_usages_session_idx").on(table.sessionId),
]; });
exports.projectDeploySecretBindings = (0, pg_core_1.pgTable)("project_deploy_secret_bindings", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    projectId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.projects.id; }, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    label: t.varchar({ length: 128 }).notNull(),
    forgegraphKey: t.varchar({ length: 128 }).notNull(),
    externalRef: t.text().notNull(),
    transport: t.varchar({ length: 32 }).notNull().default("template"),
    templateId: t.varchar({ length: 64 }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("project_deploy_secret_bindings_env_key_idx").on(table.projectId, table.environment, table.forgegraphKey),
]; });
exports.sessionSecretsRelations = (0, drizzle_orm_1.relations)(exports.sessionSecrets, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.sessionSecrets.userId],
            references: [auth_js_1.user.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionSecrets.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.sessionSecrets.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
        project: one(projects_js_1.projects, {
            fields: [exports.sessionSecrets.projectId],
            references: [projects_js_1.projects.id],
        }),
        usages: many(exports.sessionSecretUsages),
    });
});
exports.sessionSecretUsagesRelations = (0, drizzle_orm_1.relations)(exports.sessionSecretUsages, function (_a) {
    var one = _a.one;
    return ({
        secret: one(exports.sessionSecrets, {
            fields: [exports.sessionSecretUsages.secretId],
            references: [exports.sessionSecrets.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionSecretUsages.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
exports.projectDeploySecretBindingsRelations = (0, drizzle_orm_1.relations)(exports.projectDeploySecretBindings, function (_a) {
    var one = _a.one;
    return ({
        project: one(projects_js_1.projects, {
            fields: [exports.projectDeploySecretBindings.projectId],
            references: [projects_js_1.projects.id],
        }),
    });
});
var templateObject_1, templateObject_2;
