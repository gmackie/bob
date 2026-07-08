// =============================================================================
// @bob/tenancy/schema — Tenancy tables (tenants, tenantMembers, workspaces,
// workspaceMembers).
// =============================================================================

import { relations, sql } from "drizzle-orm";
import { pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "@bob/auth/schema";
import { projects } from "@bob/projects/schema";

// --- Tenants ---

export const tenantPlanEnum = pgEnum("tenant_plan", ["free", "premium", "pro"]);

export const tenantMemberRoleEnum = pgEnum("tenant_member_role", [
  "owner",
  "admin",
  "member",
]);

// Stripe subscription lifecycle statuses. Mirrors Stripe's `subscription.status`
// so a webhook can persist the raw status without lossy mapping.
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

export const tenants = pgTable("tenants", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 128 }).notNull(),
  slug: t.varchar({ length: 64 }).notNull().unique(),
  plan: tenantPlanEnum("plan").notNull().default("free"),
  // Stripe customer this tenant is billed through. Set on first checkout and
  // reused so a tenant never accumulates duplicate Stripe customers.
  stripeCustomerId: t.text("stripe_customer_id").unique(),
  forgeGraphProjectId: t.text("forge_graph_project_id"),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

// --- Subscriptions ---
//
// One active subscription record per tenant, kept in sync from Stripe webhooks.
// `tenants.plan` is the denormalized entitlement source of truth used for
// gating; this table is the audit trail / reconciliation source that produced
// it. Keeping both lets read-heavy entitlement checks avoid a join.
export const tenantSubscriptions = pgTable("tenant_subscriptions", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  tenantId: t
    .uuid("tenant_id")
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: "cascade" }),
  stripeCustomerId: t.text("stripe_customer_id").notNull(),
  stripeSubscriptionId: t.text("stripe_subscription_id").notNull().unique(),
  stripePriceId: t.text("stripe_price_id").notNull(),
  status: subscriptionStatusEnum("status").notNull(),
  // Plan derived from the Stripe price at the time the webhook was processed.
  plan: tenantPlanEnum("plan").notNull(),
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
}));

export const tenantMembers = pgTable(
  "tenant_members",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    tenantId: t
      .uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: t.text("user_id").notNull(),
    role: tenantMemberRoleEnum("role").notNull().default("member"),
    joinedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("tenant_members_tenant_user_idx").on(
      table.tenantId,
      table.userId,
    ),
  ],
);

// --- Workspaces ---

export const workspaceMemberRole = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRole)[number];
export const workspaceMemberRoleEnum = pgEnum(
  "workspace_member_role",
  workspaceMemberRole,
);

export const workspaces = pgTable("workspaces", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  ownerUserId: t
    .text("owner_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.varchar({ length: 128 }).notNull(),
  slug: t.varchar({ length: 64 }).notNull().unique(),
  description: t.text(),
  createdAt: t
    .timestamp("created_at", { mode: "string" })
    .defaultNow()
    .notNull(),
  updatedAt: t
    .timestamp("updated_at", { mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  tenantId: t.uuid("tenant_id").references(() => tenants.id, {
    onDelete: "cascade",
  }),
  machineId: t.text("machine_id"),
  lastHeartbeat: t.timestamp("last_heartbeat", { mode: "string" }),
  agentConfigs: t.json("agent_configs").$type<Record<string, unknown>>(),
  // Default agent for this workspace's work (and for OODA sessions bound to
  // this workspace). Bottom of the resolveAgentType hierarchy. Nullable =
  // unset -> falls through to the hardcoded default.
  defaultAgentType: t.varchar("default_agent_type", { length: 50 }),
  forgeAvailable: t.boolean("forge_available").default(false),
  forgeApiKey: t.text("forge_api_key"),
  devDir: t.text("dev_dir"),
}));

export const workspaceMembers = pgTable("workspace_members", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: workspaceMemberRoleEnum().notNull().default("member"),
  joinedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

// --- Relations ---

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  members: many(tenantMembers),
  subscription: one(tenantSubscriptions, {
    fields: [tenants.id],
    references: [tenantSubscriptions.tenantId],
  }),
}));

export const tenantSubscriptionsRelations = relations(
  tenantSubscriptions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantSubscriptions.tenantId],
      references: [tenants.id],
    }),
  }),
);

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  ownerUser: one(user, {
    fields: [workspaces.ownerUserId],
    references: [user.id],
  }),
  tenant: one(tenants, {
    fields: [workspaces.tenantId],
    references: [tenants.id],
  }),
  members: many(workspaceMembers),
  projects: many(projects),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(user, {
      fields: [workspaceMembers.userId],
      references: [user.id],
    }),
  }),
);
