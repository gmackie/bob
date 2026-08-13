"use strict";
// @bob/webhooks/schema — Webhook tables extracted from @bob/db/schema
// Phase 7B-2 Task 16.
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookDeliveriesRelations = exports.webhookConfigsRelations = exports.CreateWebhookDeliverySchema = exports.webhookDeliveries = exports.CreateWebhookConfigSchema = exports.webhookConfigs = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
var git_js_1 = require("./git.js");
var tenancy_js_1 = require("./tenancy.js");
// 1.4a Webhook Configs (outbound webhook subscriptions)
exports.webhookConfigs = (0, pg_core_1.pgTable)("webhook_configs", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    workspaceId: t
        .uuid()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    url: t.text().notNull(),
    secret: t.text().notNull(),
    events: t.json().$type().notNull().default([]),
    active: t.boolean().notNull().default(true),
    description: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.index)("webhook_configs_user_id_idx").on(table.userId),
    (0, pg_core_1.index)("webhook_configs_workspace_id_idx").on(table.workspaceId),
]; });
exports.CreateWebhookConfigSchema = (0, drizzle_zod_1.createInsertSchema)(exports.webhookConfigs, {
    url: v4_1.z.string().url(),
    secret: v4_1.z.string().min(16),
    events: v4_1.z.array(v4_1.z.string()).default([]),
    active: v4_1.z.boolean().default(true),
    description: v4_1.z.string().max(256).optional(),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
});
// 1.4b Webhook Deliveries (idempotency + audit)
exports.webhookDeliveries = (0, pg_core_1.pgTable)("webhook_deliveries", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    webhookConfigId: t
        .uuid()
        .references(function () { return exports.webhookConfigs.id; }, { onDelete: "set null" }),
    provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea' | 'planning'
    deliveryId: t.text(), // X-GitHub-Delivery, X-Gitea-Delivery, etc.
    eventType: t.varchar({ length: 50 }).notNull(), // e.g., 'pull_request', 'push'
    action: t.varchar({ length: 50 }), // e.g., 'opened', 'closed', 'merged'
    signatureValid: t.boolean().notNull(),
    headers: t.json().$type(),
    payload: t.json().$type().notNull(),
    status: t.varchar({ length: 20 }).notNull().default("pending"), // 'pending' | 'processed' | 'failed'
    errorMessage: t.text(),
    retryCount: t.integer().notNull().default(0),
    nextRetryAt: t.timestamp({ mode: "string", withTimezone: true }),
    processedAt: t.timestamp({ mode: "string", withTimezone: true }),
    receivedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("webhook_deliveries_config_id_idx").on(table.webhookConfigId),
    (0, pg_core_1.uniqueIndex)("webhook_deliveries_provider_delivery_unique")
        .on(table.provider, table.deliveryId)
        .where((0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["", " IS NOT NULL"], ["", " IS NOT NULL"])), table.deliveryId)),
]; });
exports.CreateWebhookDeliverySchema = (0, drizzle_zod_1.createInsertSchema)(exports.webhookDeliveries, {
    provider: v4_1.z.string().max(20),
    deliveryId: v4_1.z.string().optional(),
    eventType: v4_1.z.string().max(50),
    action: v4_1.z.string().max(50).optional(),
    signatureValid: v4_1.z.boolean(),
    status: v4_1.z.enum(git_js_1.webhookStatusEnum).default("pending"),
}).omit({
    id: true,
    receivedAt: true,
    processedAt: true,
});
exports.webhookConfigsRelations = (0, drizzle_orm_1.relations)(exports.webhookConfigs, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.webhookConfigs.userId],
            references: [auth_js_1.user.id],
        }),
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.webhookConfigs.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
        deliveries: many(exports.webhookDeliveries),
    });
});
exports.webhookDeliveriesRelations = (0, drizzle_orm_1.relations)(exports.webhookDeliveries, function (_a) {
    var one = _a.one;
    return ({
        webhookConfig: one(exports.webhookConfigs, {
            fields: [exports.webhookDeliveries.webhookConfigId],
            references: [exports.webhookConfigs.id],
        }),
    });
});
var templateObject_1, templateObject_2;
