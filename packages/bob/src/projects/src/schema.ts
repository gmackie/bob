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

import { relations, sql } from "drizzle-orm";
import { pgEnum, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { agentInstances } from "@bob/agents/schema";
import { user } from "@bob/auth/schema";
import { workspaces } from "@bob/tenancy/schema";
import { planTaskItems } from "@bob/work-items/schema";

// --- Project status enum ---

export const projectStatus = [
  "planned",
  "active",
  "in_progress",
  "paused",
  "completed",
  "archived",
] as const;
export type ProjectStatus = (typeof projectStatus)[number];
export const projectStatusEnum = pgEnum("project_status", projectStatus);

// --- Agent type / instance status (used by CreateWorktreeSchema below) ---

export const agentTypeEnum = [
  "claude",
  "kiro",
  "codex",
  "gemini",
  "grok",
  "opencode",
  "smol-agent",
  "cursor-agent",
  "elevenlabs",
] as const;
export type AgentType = (typeof agentTypeEnum)[number];

export const instanceStatusEnum = [
  "running",
  "stopped",
  "starting",
  "error",
] as const;
export type InstanceStatus = (typeof instanceStatusEnum)[number];

// --- Worktree plan / link enums ---

export const planStatusEnum = [
  "draft",
  "active",
  "completed",
  "archived",
] as const;
export type PlanStatus = (typeof planStatusEnum)[number];

export const linkTypeEnum = [
  "planning_task",
  "github_pr",
  "github_issue",
  "control_panel",
  "external",
] as const;
export type LinkType = (typeof linkTypeEnum)[number];

// --- Tables ---

export const projects = pgTable("projects", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  leadUserId: t.text().references(() => user.id, { onDelete: "set null" }),
  forgeGraphAppId: t.text().unique(), // 1:1 with ForgeGraph app
  repoUrl: t.text(), // synced from ForgeGraph
  defaultBranch: t.text(), // synced from ForgeGraph
  name: t.varchar({ length: 128 }).notNull(),
  key: t.varchar({ length: 16 }).notNull(),
  description: t.text(),
  color: t.varchar({ length: 7 }),
  status: projectStatusEnum().notNull().default("planned"),
  automationSettings: t
    .jsonb()
    .$type<{
      autoDispatch?: boolean;
      autoBranch?: boolean;
      autoFeaturePR?: boolean;
      ciTrigger?: boolean;
      reactFrontend?: boolean;
    }>()
    .notNull()
    .default({}),
  planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
  // Default agent for this project's work items; overrides the workspace
  // default, overridden by a per-work-item agentTypeOverride. Nullable = unset.
  defaultAgentType: t.varchar({ length: 50 }),
  linearProjectId: t.text(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const workspaceIntegrations = pgTable(
  "workspace_integrations",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: t.varchar({ length: 20 }).notNull(),
    enabled: t.boolean().notNull().default(true),
    apiKey: t.text(),
    webhookSigningSecret: t.text(),
    linearTeamId: t.text(),
    linearWebBaseUrl: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    {
      name: "workspace_integrations_workspace_provider_idx",
      columns: [table.workspaceId, table.provider],
      unique: true,
    },
  ],
);

export const CreateProjectSchema = createInsertSchema(projects, {
  name: z.string().min(1).max(128),
  key: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z][A-Z0-9]*$/),
  status: z.enum(projectStatus).default("planned"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const repositories = pgTable("repositories", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
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
  workspaceId: t.uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  buildSystem: t.varchar("build_system", { length: 32 }),
  dirty: t.boolean().default(false),
  stale: t.boolean().default(false),
  discoveryStatus: t.varchar("discovery_status", { length: 16 }).default("discovered"),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const discoveredDirs = pgTable("discovered_dirs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  path: t.text().notNull(),
  name: t.varchar({ length: 256 }).notNull(),
  dismissed: t.boolean().default(false),
  lastSeen: t.timestamp("last_seen", { mode: "string" }).defaultNow(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateRepositorySchema = createInsertSchema(repositories, {
  name: z.string().max(256),
  path: z.string(),
  branch: z.string().max(256),
  mainBranch: z.string().max(256).default("main"),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const worktrees = pgTable("worktrees", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  path: t.text().notNull(),
  branch: t.varchar({ length: 256 }).notNull(),
  preferredAgent: t.varchar({ length: 50 }).notNull().default("claude"),
  isMainWorktree: t.boolean().notNull().default(false),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateWorktreeSchema = createInsertSchema(worktrees, {
  path: z.string(),
  branch: z.string().max(256),
  preferredAgent: z.enum(agentTypeEnum).default("claude"),
  isMainWorktree: z.boolean().default(false),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const worktreePlans = pgTable("worktree_plans", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  worktreeId: t
    .uuid()
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  filePath: t.text().notNull(),
  title: t.varchar({ length: 256 }),
  goal: t.text(),
  status: t.varchar({ length: 20 }).notNull().default("draft"),
  planningTaskId: t.varchar("kanbanger_task_id", { length: 100 }),
  lastSyncedAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateWorktreePlanSchema = createInsertSchema(worktreePlans, {
  filePath: z.string(),
  title: z.string().max(256).optional(),
  goal: z.string().optional(),
  status: z.enum(planStatusEnum).default("draft"),
  planningTaskId: z.string().max(100).optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});

export const worktreeLinks = pgTable("worktree_links", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  worktreeId: t
    .uuid()
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  linkType: t.varchar({ length: 50 }).notNull(),
  externalId: t.varchar({ length: 256 }),
  url: t.text(),
  title: t.varchar({ length: 256 }),
  metadata: t.json().$type<Record<string, unknown>>(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateWorktreeLinkSchema = createInsertSchema(worktreeLinks, {
  linkType: z.enum(linkTypeEnum),
  externalId: z.string().max(256).optional(),
  url: z.string().url().optional(),
  title: z.string().max(256).optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

// --- Relations ---

export const repositoriesRelations = relations(
  repositories,
  ({ one, many }) => ({
    user: one(user, {
      fields: [repositories.userId],
      references: [user.id],
    }),
    worktrees: many(worktrees),
    instances: many(agentInstances),
  }),
);

export const projectsRelations = relations(projects, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  leadUser: one(user, {
    fields: [projects.leadUserId],
    references: [user.id],
  }),
}));

export const workspaceIntegrationsRelations = relations(workspaceIntegrations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceIntegrations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const worktreesRelations = relations(worktrees, ({ one, many }) => ({
  user: one(user, {
    fields: [worktrees.userId],
    references: [user.id],
  }),
  repository: one(repositories, {
    fields: [worktrees.repositoryId],
    references: [repositories.id],
  }),
  instances: many(agentInstances),
}));

export const worktreePlansRelations = relations(
  worktreePlans,
  ({ one, many }) => ({
    worktree: one(worktrees, {
      fields: [worktreePlans.worktreeId],
      references: [worktrees.id],
    }),
    user: one(user, {
      fields: [worktreePlans.userId],
      references: [user.id],
    }),
    tasks: many(planTaskItems),
  }),
);

export const worktreeLinksRelations = relations(worktreeLinks, ({ one }) => ({
  worktree: one(worktrees, {
    fields: [worktreeLinks.worktreeId],
    references: [worktrees.id],
  }),
  user: one(user, {
    fields: [worktreeLinks.userId],
    references: [user.id],
  }),
}));
