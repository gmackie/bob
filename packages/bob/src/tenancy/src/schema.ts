// =============================================================================
// @bob/tenancy/schema — Tenancy tables (tenants, tenantMembers, workspaces,
// workspaceMembers).
//
// Cross-area TODOs (resolved in later Phase 7B-2 tasks):
//   - workspacesRelations.projects → projects — Task 11 (projects move).
//     Commented out.
// =============================================================================

import { relations, sql } from "drizzle-orm";
import { pgEnum, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "@bob/auth/schema";

// --- Tenants ---

export const tenantPlanEnum = pgEnum("tenant_plan", [
  "free",
  "premium",
  "pro",
]);

export const tenantMemberRoleEnum = pgEnum("tenant_member_role", [
  "owner",
  "admin",
  "member",
]);

export const tenants = pgTable("tenants", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 128 }).notNull(),
  slug: t.varchar({ length: 64 }).notNull().unique(),
  plan: tenantPlanEnum("plan").notNull().default("free"),
  forgeGraphProjectId: t.text("forge_graph_project_id"),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
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
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.varchar({ length: 128 }).notNull(),
  slug: t.varchar({ length: 64 }).notNull().unique(),
  description: t.text(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  tenantId: t.uuid("tenant_id").references(() => tenants.id, {
    onDelete: "cascade",
  }),
  machineId: t.text("machine_id"),
  lastHeartbeat: t.timestamp("last_heartbeat", { mode: "string" }),
  agentConfigs: t.json("agent_configs").$type<Record<string, unknown>>(),
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

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
}));

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
  // TODO Phase 7B-2 Task 11: re-enable projects → projects when projects moves.
  // projects: many(projects),
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
