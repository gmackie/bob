"use strict";
// =============================================================================
// @bob/tenancy/schema — Tenancy tables (tenants, tenantMembers, workspaces,
// workspaceMembers).
// =============================================================================
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceMembersRelations = exports.workspacesRelations = exports.tenantMembersRelations = exports.tenantSubscriptionsRelations = exports.tenantsRelations = exports.workspaceMembers = exports.workspaces = exports.workspaceMemberRoleEnum = exports.workspaceMemberRole = exports.tenantMembers = exports.tenantSubscriptions = exports.tenants = exports.subscriptionStatusEnum = exports.tenantMemberRoleEnum = exports.tenantPlanEnum = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var auth_js_1 = require("./auth.js");
var projects_js_1 = require("./projects.js");
// --- Tenants ---
exports.tenantPlanEnum = (0, pg_core_1.pgEnum)("tenant_plan", ["free", "premium", "pro"]);
exports.tenantMemberRoleEnum = (0, pg_core_1.pgEnum)("tenant_member_role", [
    "owner",
    "admin",
    "member",
]);
// Stripe subscription lifecycle statuses. Mirrors Stripe's `subscription.status`
// so a webhook can persist the raw status without lossy mapping.
exports.subscriptionStatusEnum = (0, pg_core_1.pgEnum)("subscription_status", [
    "active",
    "trialing",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
]);
exports.tenants = (0, pg_core_1.pgTable)("tenants", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    name: t.varchar({ length: 128 }).notNull(),
    slug: t.varchar({ length: 64 }).notNull().unique(),
    plan: (0, exports.tenantPlanEnum)("plan").notNull().default("free"),
    // Stripe customer this tenant is billed through. Set on first checkout and
    // reused so a tenant never accumulates duplicate Stripe customers.
    stripeCustomerId: t.text("stripe_customer_id").unique(),
    forgeGraphProjectId: t.text("forge_graph_project_id"),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
// --- Subscriptions ---
//
// One active subscription record per tenant, kept in sync from Stripe webhooks.
// `tenants.plan` is the denormalized entitlement source of truth used for
// gating; this table is the audit trail / reconciliation source that produced
// it. Keeping both lets read-heavy entitlement checks avoid a join.
exports.tenantSubscriptions = (0, pg_core_1.pgTable)("tenant_subscriptions", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    tenantId: t
        .uuid("tenant_id")
        .notNull()
        .unique()
        .references(function () { return exports.tenants.id; }, { onDelete: "cascade" }),
    stripeCustomerId: t.text("stripe_customer_id").notNull(),
    stripeSubscriptionId: t.text("stripe_subscription_id").notNull().unique(),
    stripePriceId: t.text("stripe_price_id").notNull(),
    status: (0, exports.subscriptionStatusEnum)("status").notNull(),
    // Plan derived from the Stripe price at the time the webhook was processed.
    plan: (0, exports.tenantPlanEnum)("plan").notNull(),
    cancelAtPeriodEnd: t.boolean("cancel_at_period_end").notNull().default(false),
    currentPeriodEnd: t.timestamp("current_period_end", { mode: "string" }),
    createdAt: t
        .timestamp("created_at", { mode: "string" })
        .defaultNow()
        .notNull(),
    updatedAt: t
        .timestamp("updated_at", { mode: "string" })
        .defaultNow()
        .notNull(),
}); });
exports.tenantMembers = (0, pg_core_1.pgTable)("tenant_members", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    tenantId: t
        .uuid("tenant_id")
        .notNull()
        .references(function () { return exports.tenants.id; }, { onDelete: "cascade" }),
    userId: t.text("user_id").notNull(),
    role: (0, exports.tenantMemberRoleEnum)("role").notNull().default("member"),
    joinedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("tenant_members_tenant_user_idx").on(table.tenantId, table.userId),
]; });
// --- Workspaces ---
exports.workspaceMemberRole = [
    "owner",
    "admin",
    "member",
    "viewer",
];
exports.workspaceMemberRoleEnum = (0, pg_core_1.pgEnum)("workspace_member_role", exports.workspaceMemberRole);
exports.workspaces = (0, pg_core_1.pgTable)("workspaces", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    ownerUserId: t
        .text("owner_user_id")
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    name: t.varchar({ length: 128 }).notNull(),
    slug: t.varchar({ length: 64 }).notNull().unique(),
    description: t.text(),
    createdAt: t
        .timestamp("created_at", { mode: "string" })
        .defaultNow()
        .notNull(),
    updatedAt: t
        .timestamp("updated_at", { mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
    tenantId: t.uuid("tenant_id").references(function () { return exports.tenants.id; }, {
        onDelete: "cascade",
    }),
    machineId: t.text("machine_id"),
    lastHeartbeat: t.timestamp("last_heartbeat", { mode: "string" }),
    agentConfigs: t.json("agent_configs").$type(),
    // Default agent for this workspace's work (and for OODA sessions bound to
    // this workspace). Bottom of the resolveAgentType hierarchy. Nullable =
    // unset -> falls through to the hardcoded default.
    defaultAgentType: t.varchar("default_agent_type", { length: 50 }),
    forgeAvailable: t.boolean("forge_available").default(false),
    forgeApiKey: t.text("forge_api_key"),
    devDir: t.text("dev_dir"),
}); });
exports.workspaceMembers = (0, pg_core_1.pgTable)("workspace_members", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workspaces.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    role: (0, exports.workspaceMemberRoleEnum)().notNull().default("member"),
    joinedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
// --- Relations ---
exports.tenantsRelations = (0, drizzle_orm_1.relations)(exports.tenants, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        members: many(exports.tenantMembers),
        subscription: one(exports.tenantSubscriptions, {
            fields: [exports.tenants.id],
            references: [exports.tenantSubscriptions.tenantId],
        }),
    });
});
exports.tenantSubscriptionsRelations = (0, drizzle_orm_1.relations)(exports.tenantSubscriptions, function (_a) {
    var one = _a.one;
    return ({
        tenant: one(exports.tenants, {
            fields: [exports.tenantSubscriptions.tenantId],
            references: [exports.tenants.id],
        }),
    });
});
exports.tenantMembersRelations = (0, drizzle_orm_1.relations)(exports.tenantMembers, function (_a) {
    var one = _a.one;
    return ({
        tenant: one(exports.tenants, {
            fields: [exports.tenantMembers.tenantId],
            references: [exports.tenants.id],
        }),
    });
});
exports.workspacesRelations = (0, drizzle_orm_1.relations)(exports.workspaces, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        ownerUser: one(auth_js_1.user, {
            fields: [exports.workspaces.ownerUserId],
            references: [auth_js_1.user.id],
        }),
        tenant: one(exports.tenants, {
            fields: [exports.workspaces.tenantId],
            references: [exports.tenants.id],
        }),
        members: many(exports.workspaceMembers),
        projects: many(projects_js_1.projects),
    });
});
exports.workspaceMembersRelations = (0, drizzle_orm_1.relations)(exports.workspaceMembers, function (_a) {
    var one = _a.one;
    return ({
        workspace: one(exports.workspaces, {
            fields: [exports.workspaceMembers.workspaceId],
            references: [exports.workspaces.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.workspaceMembers.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
var templateObject_1;
