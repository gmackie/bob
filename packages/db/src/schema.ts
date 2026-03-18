import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "./auth-schema";

export const Post = pgTable("post", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  title: t.varchar({ length: 256 }).notNull(),
  content: t.text().notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreatePostSchema = createInsertSchema(Post, {
  title: z.string().max(256),
  content: z.string().max(256),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const userPreferences = pgTable("user_preferences", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: t.varchar({ length: 20 }).notNull().default("system"),
  language: t.varchar({ length: 10 }).notNull().default("en"),
  timezone: t.varchar({ length: 50 }).notNull().default("UTC"),
  emailNotifications: t.boolean().notNull().default(true),
  pushNotifications: t.boolean().notNull().default(true),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const apiKeys = pgTable("api_keys", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.varchar({ length: 100 }).notNull(),
  keyHash: t.text().notNull(),
  keyPrefix: t.varchar({ length: 12 }).notNull(),
  permissions: t.json().$type<string[]>().notNull().default(["read"]),
  lastUsedAt: t.timestamp({ mode: "date", withTimezone: true }),
  expiresAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));

export const workItemKind = ["issue", "epic", "task"] as const;
export type WorkItemKind = (typeof workItemKind)[number];
export const workItemKindEnum = pgEnum("work_item_kind", workItemKind);

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

export const projectStatus = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "archived",
] as const;
export type ProjectStatus = (typeof projectStatus)[number];
export const projectStatusEnum = pgEnum("project_status", projectStatus);

export const workItemActivityType = [
  "comment_added",
  "status_changed",
  "artifact_added",
  "notification_created",
  "build_status_changed",
  "deploy_status_changed",
] as const;
export type WorkItemActivityType = (typeof workItemActivityType)[number];
export const workItemActivityTypeEnum = pgEnum(
  "work_item_activity_type",
  workItemActivityType,
);

export const workItemNotificationType = [
  "work_item_assigned",
  "work_item_commented",
  "work_item_needs_input",
  "work_item_review_ready",
  "task_completed",
  "batch_completed",
] as const;
export type WorkItemNotificationType =
  (typeof workItemNotificationType)[number];
export const workItemNotificationTypeEnum = pgEnum(
  "work_item_notification_type",
  workItemNotificationType,
);

export const workItemArtifactType = [
  "pr",
  "verification",
  "build",
  "test_report",
  "doc",
  "deliverable",
  "other",
] as const;
export type WorkItemArtifactType = (typeof workItemArtifactType)[number];
export const workItemArtifactTypeEnum = pgEnum(
  "work_item_artifact_type",
  workItemArtifactType,
);

export const workItemArtifactProducerType = [
  "bob",
  "forgegraph",
  "human",
  "system",
] as const;
export type WorkItemArtifactProducerType =
  (typeof workItemArtifactProducerType)[number];
export const workItemArtifactProducerTypeEnum = pgEnum(
  "work_item_artifact_producer_type",
  workItemArtifactProducerType,
);

export const workItems = pgTable("work_items", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  parentId: t.uuid(),
  ownerUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  assigneeUserId: t.text(),
  workspaceId: t.uuid(),
  projectId: t.uuid(),
  sequenceNumber: t.integer().notNull().default(0),
  kind: workItemKindEnum().notNull(),
  title: t.varchar({ length: 256 }).notNull(),
  description: t.text(),
  status: t.varchar({ length: 40 }).notNull().default("draft"),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const planDrafts = pgTable(
  "plan_drafts",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    workspaceId: t.uuid().notNull(),
    projectId: t.uuid().notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text(),
    kind: workItemKindEnum().notNull().default("task"),
    priority: t.varchar({ length: 20 }).notNull().default("no_priority"),
    sortOrder: t.integer().notNull().default(0),
    status: t.varchar({ length: 20 }).notNull().default("draft"),
    // status: "draft" | "committed" | "discarded"
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "plan_drafts_session_idx", columns: [table.sessionId] },
  ],
);

export const planDraftDependencies = pgTable(
  "plan_draft_dependencies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    draftId: t
      .uuid()
      .notNull()
      .references(() => planDrafts.id, { onDelete: "cascade" }),
    dependsOnDraftId: t
      .uuid()
      .notNull()
      .references(() => planDrafts.id, { onDelete: "cascade" }),
  }),
  (table) => [
    {
      name: "plan_draft_deps_unique_idx",
      columns: [table.draftId, table.dependsOnDraftId],
      unique: true,
    },
  ],
);

export const planDraftsRelations = relations(planDrafts, ({ one, many }) => ({
  session: one(chatConversations, {
    fields: [planDrafts.sessionId],
    references: [chatConversations.id],
  }),
  dependencies: many(planDraftDependencies, { relationName: "draft" }),
  dependedOnBy: many(planDraftDependencies, { relationName: "dependsOn" }),
}));

export const planDraftDependenciesRelations = relations(
  planDraftDependencies,
  ({ one }) => ({
    draft: one(planDrafts, {
      fields: [planDraftDependencies.draftId],
      references: [planDrafts.id],
      relationName: "draft",
    }),
    dependsOn: one(planDrafts, {
      fields: [planDraftDependencies.dependsOnDraftId],
      references: [planDrafts.id],
      relationName: "dependsOn",
    }),
  }),
);

// =============================================================================
// Dispatch Tables (batch execution of planning tasks)
// =============================================================================

export const dispatchBatches = pgTable("dispatch_batches", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t.text().notNull().references(() => user.id, { onDelete: "cascade" }),
  sessionId: t.uuid().references(() => chatConversations.id, { onDelete: "set null" }),
  workspaceId: t.text().notNull(),
  projectId: t.text().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"),
  // status: "pending" | "dispatching" | "running" | "completed" | "failed"
  concurrency: t.integer().notNull().default(2),
  totalTasks: t.integer().notNull().default(0),
  completedTasks: t.integer().notNull().default(0),
  failedTasks: t.integer().notNull().default(0),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
}));

export const dispatchItems = pgTable(
  "dispatch_items",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    batchId: t.uuid().notNull().references(() => dispatchBatches.id, { onDelete: "cascade" }),
    planningTaskId: t.text().notNull(),
    planningTaskIdentifier: t.text().notNull(),
    title: t.text().notNull(),
    description: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    // status: "queued" | "blocked" | "running" | "completed" | "failed"
    blockedByItems: t.json().$type<string[]>().default([]),
    // Array of dispatchItem IDs that must complete before this one starts
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    sortOrder: t.integer().notNull().default(0),
    pipelineState: t.varchar({ length: 30 }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "dispatch_items_batch_idx", columns: [table.batchId] },
  ],
);

export const dispatchBatchesRelations = relations(
  dispatchBatches,
  ({ one, many }) => ({
    user: one(user, {
      fields: [dispatchBatches.userId],
      references: [user.id],
    }),
    session: one(chatConversations, {
      fields: [dispatchBatches.sessionId],
      references: [chatConversations.id],
    }),
    items: many(dispatchItems),
  }),
);

export const dispatchItemsRelations = relations(
  dispatchItems,
  ({ one }) => ({
    batch: one(dispatchBatches, {
      fields: [dispatchItems.batchId],
      references: [dispatchBatches.id],
    }),
    taskRun: one(taskRuns, {
      fields: [dispatchItems.taskRunId],
      references: [taskRuns.id],
    }),
  }),
);

export const CreateUserPreferencesSchema = createInsertSchema(userPreferences, {
  theme: z.enum(["light", "dark", "system"]).default("system"),
  language: z.string().max(10).default("en"),
  timezone: z.string().max(50).default("UTC"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateUserPreferencesSchema =
  CreateUserPreferencesSchema.partial().omit({
    userId: true,
  });

export const CreateWorkItemSchema = createInsertSchema(workItems, {
  kind: z.enum(workItemKind),
  title: z.string().max(256),
  status: z.string().max(40).default("draft"),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const workspaces = pgTable("workspaces", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  ownerUserId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: t.varchar({ length: 128 }).notNull(),
  slug: t.varchar({ length: 64 }).notNull().unique(),
  description: t.text(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateWorkspaceSchema = createInsertSchema(workspaces, {
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
}).omit({
  id: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
});

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
  joinedAt: t.timestamp().defaultNow().notNull(),
}));

export const projects = pgTable("projects", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workspaceId: t
    .uuid()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  leadUserId: t.text().references(() => user.id, { onDelete: "set null" }),
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
    }>()
    .notNull()
    .default({}),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

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

export const agentTypeEnum = [
  "claude",
  "kiro",
  "codex",
  "gemini",
  "opencode",
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
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
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
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
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

export const agentInstances = pgTable("agent_instances", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  worktreeId: t
    .uuid()
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  agentType: t.varchar({ length: 50 }).notNull().default("claude"),
  status: t.varchar({ length: 20 }).notNull().default("stopped"),
  pid: t.integer(),
  port: t.integer(),
  errorMessage: t.text(),
  lastActivity: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateAgentInstanceSchema = createInsertSchema(agentInstances, {
  agentType: z.enum(agentTypeEnum).default("claude"),
  status: z.enum(instanceStatusEnum).default("stopped"),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const tokenUsageSessions = pgTable("token_usage_sessions", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  instanceId: t
    .uuid()
    .notNull()
    .references(() => agentInstances.id, { onDelete: "cascade" }),
  worktreeId: t
    .uuid()
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  inputTokens: t.integer().notNull().default(0),
  outputTokens: t.integer().notNull().default(0),
  cacheReadTokens: t.integer().notNull().default(0),
  cacheCreationTokens: t.integer().notNull().default(0),
  totalCostUsd: t.numeric({ precision: 10, scale: 6 }).notNull().default("0"),
  sessionStart: t.timestamp().notNull(),
  sessionEnd: t.timestamp(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const instanceUsageSummary = pgTable("instance_usage_summary", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  instanceId: t
    .uuid()
    .notNull()
    .unique()
    .references(() => agentInstances.id, { onDelete: "cascade" }),
  worktreeId: t
    .uuid()
    .notNull()
    .references(() => worktrees.id, { onDelete: "cascade" }),
  repositoryId: t
    .uuid()
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  totalInputTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalOutputTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCacheReadTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCacheCreationTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCostUsd: t.numeric({ precision: 12, scale: 6 }).notNull().default("0"),
  sessionCount: t.integer().notNull().default(0),
  firstUsage: t.timestamp().notNull(),
  lastUsage: t.timestamp().notNull(),
}));

export const dailyUsageStats = pgTable("daily_usage_stats", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  date: t.date().notNull().unique(),
  totalInputTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalOutputTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCacheReadTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCacheCreationTokens: t.bigint({ mode: "number" }).notNull().default(0),
  totalCostUsd: t.numeric({ precision: 12, scale: 6 }).notNull().default("0"),
  sessionCount: t.integer().notNull().default(0),
  activeInstances: t.integer().notNull().default(0),
}));

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

export const requirementCategory = [
  "data",
  "api",
  "ui",
  "infra",
  "test",
  "other",
] as const;
export type RequirementCategory = (typeof requirementCategory)[number];

export const requirementStatus = [
  "pending",
  "in_progress",
  "done",
] as const;
export type RequirementStatus = (typeof requirementStatus)[number];

export const requirements = pgTable("requirements", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  category: t
    .text({ enum: requirementCategory })
    .notNull()
    .default("other"),
  description: t.text().notNull(),
  status: t
    .text({ enum: requirementStatus })
    .notNull()
    .default("pending"),
  linkedTaskId: t.uuid(),
  sortOrder: t.integer().notNull().default(0),
  createdAt: t.timestamp().defaultNow().notNull(),
}), (table) => [
  index("requirements_work_item_id_idx").on(table.workItemId),
]);

export const requirementsRelations = relations(
  requirements,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [requirements.workItemId],
      references: [workItems.id],
      relationName: "work_item_requirements",
    }),
    linkedTask: one(workItems, {
      fields: [requirements.linkedTaskId],
      references: [workItems.id],
      relationName: "requirement_linked_task",
    }),
  }),
);

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  ownerUser: one(user, {
    fields: [workItems.ownerUserId],
    references: [user.id],
  }),
  assigneeUser: one(user, {
    fields: [workItems.assigneeUserId],
    references: [user.id],
  }),
  workspace: one(workspaces, {
    fields: [workItems.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [workItems.projectId],
    references: [projects.id],
  }),
  parent: one(workItems, {
    fields: [workItems.parentId],
    references: [workItems.id],
    relationName: "work_item_parent",
  }),
  children: many(workItems, {
    relationName: "work_item_parent",
  }),
  requirements: many(requirements, {
    relationName: "work_item_requirements",
  }),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  ownerUser: one(user, {
    fields: [workspaces.ownerUserId],
    references: [user.id],
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

export const agentInstancesRelations = relations(agentInstances, ({ one }) => ({
  user: one(user, {
    fields: [agentInstances.userId],
    references: [user.id],
  }),
  repository: one(repositories, {
    fields: [agentInstances.repositoryId],
    references: [repositories.id],
  }),
  worktree: one(worktrees, {
    fields: [agentInstances.worktreeId],
    references: [worktrees.id],
  }),
}));

export const messageRoleEnum = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof messageRoleEnum)[number];

export const sessionStatusEnum = [
  "provisioning",
  "starting",
  "running",
  "idle",
  "stopping",
  "stopped",
  "error",
] as const;
export type SessionStatus = (typeof sessionStatusEnum)[number];

export const workflowStatusEnum = [
  "started",
  "working",
  "awaiting_input",
  "blocked",
  "awaiting_review",
  "completed",
] as const;
export type WorkflowStatus = (typeof workflowStatusEnum)[number];

export const chatConversations = pgTable(
  "chat_conversations",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repositoryId: t
      .uuid()
      .references(() => repositories.id, { onDelete: "set null" }),
    worktreeId: t
      .uuid()
      .references(() => worktrees.id, { onDelete: "set null" }),
    agentInstanceId: t
      .uuid()
      .references(() => agentInstances.id, { onDelete: "set null" }),
    title: t.varchar({ length: 256 }),
    workingDirectory: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    sessionType: t.varchar({ length: 20 }).notNull().default("execution"),
    opencodeSessionId: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("stopped"),
    nextSeq: t.bigint({ mode: "number" }).notNull().default(1),
    lastActivityAt: t.timestamp({ mode: "date", withTimezone: true }),
    lastError: t
      .json()
      .$type<{ code: string; message: string; timestamp: string }>(),
    claimedByGatewayId: t.text(),
    leaseExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
    gitBranch: t.text(),
    pullRequestId: t.uuid(),
    planningTaskId: t.text("kanbanger_task_id"),
    workItemId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    workItemIdentifierSnapshot: t.text(),
    blockedReason: t.text(),
    workflowStatus: t.varchar({ length: 30 }).notNull().default("started"),
    statusMessage: t.text(),
    awaitingInputQuestion: t.text(),
    awaitingInputOptions: t.json().$type<string[]>(),
    awaitingInputDefault: t.text(),
    awaitingInputExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
    awaitingInputResolvedAt: t.timestamp({ mode: "date", withTimezone: true }),
    awaitingInputResolution: t
      .json()
      .$type<{ type: "human" | "timeout"; value: string }>(),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }),
  }),
  (table) => [
    {
      name: "chat_conversations_workflow_expires_idx",
      columns: [table.workflowStatus, table.awaitingInputExpiresAt],
    },
    {
      name: "chat_conversations_kanbanger_task_idx",
      columns: [table.planningTaskId],
    },
    {
      name: "chat_conversations_work_item_idx",
      columns: [table.workItemId],
    },
  ],
);

export const chatMessages = pgTable("chat_messages", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  conversationId: t
    .uuid()
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  role: t.varchar({ length: 20 }).notNull(),
  content: t.text().notNull(),
  toolCalls: t
    .json()
    .$type<Array<{ id: string; name: string; arguments: string }>>(),
  toolCallId: t.varchar({ length: 100 }),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const chatConversationsRelations = relations(
  chatConversations,
  ({ one, many }) => ({
    user: one(user, {
      fields: [chatConversations.userId],
      references: [user.id],
    }),
    repository: one(repositories, {
      fields: [chatConversations.repositoryId],
      references: [repositories.id],
    }),
    worktree: one(worktrees, {
      fields: [chatConversations.worktreeId],
      references: [worktrees.id],
    }),
    agentInstance: one(agentInstances, {
      fields: [chatConversations.agentInstanceId],
      references: [agentInstances.id],
    }),
    workItem: one(workItems, {
      fields: [chatConversations.workItemId],
      references: [workItems.id],
    }),
    messages: many(chatMessages),
    events: many(sessionEvents),
    connections: many(sessionConnections),
    planDrafts: many(planDrafts),
  }),
);

export const chatAttachments = pgTable("chat_attachments", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  messageId: t
    .uuid()
    .references(() => chatMessages.id, { onDelete: "cascade" }),
  type: t.text({ enum: ["image", "file"] }).notNull().default("image"),
  url: t.text().notNull(),
  filename: t.text(),
  mimeType: t.text(),
  width: t.integer(),
  height: t.integer(),
  sizeBytes: t.integer(),
  createdAt: t.timestamp().defaultNow().notNull(),
}), (table) => [
  index("chat_attachments_message_id_idx").on(table.messageId),
]);

export const chatMessagesRelations = relations(
  chatMessages,
  ({ one, many }) => ({
    conversation: one(chatConversations, {
      fields: [chatMessages.conversationId],
      references: [chatConversations.id],
    }),
    attachments: many(chatAttachments),
  }),
);

export const chatAttachmentsRelations = relations(
  chatAttachments,
  ({ one }) => ({
    message: one(chatMessages, {
      fields: [chatAttachments.messageId],
      references: [chatMessages.id],
    }),
  }),
);

export const planStatusEnum = [
  "draft",
  "active",
  "completed",
  "archived",
] as const;
export type PlanStatus = (typeof planStatusEnum)[number];

export const taskStatusEnum = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatusEnum)[number];

export const linkTypeEnum = [
  "planning_task",
  "github_pr",
  "github_issue",
  "control_panel",
  "external",
] as const;
export type LinkType = (typeof linkTypeEnum)[number];

export const eventTypeEnum = [
  "instance.started",
  "instance.stopped",
  "instance.error",
  "git.commit",
  "git.push",
  "git.pull",
  "git.checkout",
  "file.created",
  "file.modified",
  "file.deleted",
  "plan.created",
  "plan.updated",
  "plan.task_completed",
  "chat.message",
  "chat.tool_call",
  "chat.tool_result",
  "worktree.created",
  "worktree.deleted",
  "link.created",
  "link.removed",
] as const;
export type EventType = (typeof eventTypeEnum)[number];

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
  lastSyncedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
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
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
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

export const planTaskItems = pgTable("plan_task_items", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  planId: t
    .uuid()
    .notNull()
    .references(() => worktreePlans.id, { onDelete: "cascade" }),
  taskKey: t.varchar({ length: 20 }).notNull(),
  content: t.text().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"),
  priority: t.varchar({ length: 10 }).notNull().default("medium"),
  parentTaskKey: t.varchar({ length: 20 }),
  sortOrder: t.integer().notNull().default(0),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreatePlanTaskItemSchema = createInsertSchema(planTaskItems, {
  taskKey: z.string().max(20),
  content: z.string(),
  status: z.enum(taskStatusEnum).default("pending"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  parentTaskKey: z.string().max(20).optional(),
  sortOrder: z.number().int().default(0),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const eventLog = pgTable("event_log", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  eventType: t.varchar({ length: 50 }).notNull(),
  payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const sessionEventDirectionEnum = ["client", "agent", "system"] as const;
export type SessionEventDirection = (typeof sessionEventDirectionEnum)[number];

export const sessionEventTypeEnum = [
  "output_chunk",
  "message_final",
  "input",
  "tool_call",
  "tool_result",
  "state",
  "error",
  "heartbeat",
] as const;
export type SessionEventType = (typeof sessionEventTypeEnum)[number];

export const sessionEvents = pgTable(
  "session_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    seq: t.bigint({ mode: "number" }).notNull(),
    direction: t.varchar({ length: 20 }).notNull(),
    eventType: t.varchar({ length: 30 }).notNull(),
    payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    {
      name: "session_events_session_seq_unique",
      columns: [table.sessionId, table.seq],
      unique: true,
    },
  ],
);

export const deviceTypeEnum = [
  "web",
  "ios",
  "android",
  "desktop",
  "other",
] as const;
export type DeviceType = (typeof deviceTypeEnum)[number];

export const sessionConnections = pgTable("session_connections", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => chatConversations.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  clientId: t.text().notNull(),
  deviceType: t.varchar({ length: 20 }).notNull().default("web"),
  connectedAt: t.timestamp().defaultNow().notNull(),
  disconnectedAt: t.timestamp({ mode: "date", withTimezone: true }),
  lastSeenAt: t.timestamp({ mode: "date", withTimezone: true }),
  lastAckSeq: t.bigint({ mode: "number" }).notNull().default(0),
  ip: t.text(),
  userAgent: t.text(),
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

export const planTaskItemsRelations = relations(planTaskItems, ({ one }) => ({
  plan: one(worktreePlans, {
    fields: [planTaskItems.planId],
    references: [worktreePlans.id],
  }),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  user: one(user, {
    fields: [eventLog.userId],
    references: [user.id],
  }),
  worktree: one(worktrees, {
    fields: [eventLog.worktreeId],
    references: [worktrees.id],
  }),
  repository: one(repositories, {
    fields: [eventLog.repositoryId],
    references: [repositories.id],
  }),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(chatConversations, {
    fields: [sessionEvents.sessionId],
    references: [chatConversations.id],
  }),
}));

export const sessionConnectionsRelations = relations(
  sessionConnections,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [sessionConnections.sessionId],
      references: [chatConversations.id],
    }),
    user: one(user, {
      fields: [sessionConnections.userId],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// GitHub Integration Tables (Phase 1)
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

export const taskRunStatusEnum = [
  "starting",
  "running",
  "blocked",
  "completed",
  "failed",
] as const;
export type TaskRunStatus = (typeof taskRunStatusEnum)[number];

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
    accessTokenExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
    refreshTokenExpiresAt: t.timestamp({ mode: "date", withTimezone: true }),
    revokedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
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
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  mergedAt: t.timestamp({ mode: "date", withTimezone: true }),
  closedAt: t.timestamp({ mode: "date", withTimezone: true }),
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
  createdAt: t.timestamp().defaultNow().notNull(),
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
  createdAt: t.timestamp().defaultNow().notNull(),
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
  mergedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
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
  committedAt: t.timestamp({ mode: "date", withTimezone: true }).notNull(),
  sessionId: t
    .uuid()
    .references(() => chatConversations.id, { onDelete: "set null" }),
  isBobCommit: t.boolean().notNull().default(false),
  createdAt: t.timestamp().defaultNow().notNull(),
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

// 1.4 Webhook Deliveries (idempotency + audit)
export const webhookDeliveries = pgTable("webhook_deliveries", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea' | 'planning'
  deliveryId: t.text(), // X-GitHub-Delivery, X-Gitea-Delivery, etc.
  eventType: t.varchar({ length: 50 }).notNull(), // e.g., 'pull_request', 'push'
  action: t.varchar({ length: 50 }), // e.g., 'opened', 'closed', 'merged'
  signatureValid: t.boolean().notNull(),
  headers: t.json().$type<Record<string, string>>(),
  payload: t.json().$type<Record<string, unknown>>().notNull(),
  status: t.varchar({ length: 20 }).notNull().default("pending"), // 'pending' | 'processed' | 'failed'
  errorMessage: t.text(),
  retryCount: t.integer().notNull().default(0),
  nextRetryAt: t.timestamp({ mode: "date", withTimezone: true }),
  processedAt: t.timestamp({ mode: "date", withTimezone: true }),
  receivedAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateWebhookDeliverySchema = createInsertSchema(
  webhookDeliveries,
  {
    provider: z.string().max(20),
    deliveryId: z.string().optional(),
    eventType: z.string().max(50),
    action: z.string().max(50).optional(),
    signatureValid: z.boolean(),
    status: z.enum(webhookStatusEnum).default("pending"),
  },
).omit({
  id: true,
  receivedAt: true,
  processedAt: true,
});

// 1.5 Task Runs (planning execution tracking)
export const taskRuns = pgTable("task_runs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  planningWorkspaceId: t.text("kanbanger_workspace_id").notNull(),
  planningItemId: t.text("kanbanger_issue_id").notNull(),
  planningItemIdentifier: t.text("kanbanger_issue_identifier").notNull(), // e.g., "PROJ-123"
  workItemId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
  workItemIdentifierSnapshot: t.text(),
  sessionId: t
    .uuid()
    .references(() => chatConversations.id, { onDelete: "set null" }),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  pullRequestId: t
    .uuid()
    .references(() => pullRequests.id, { onDelete: "set null" }),
  status: t.varchar({ length: 20 }).notNull(), // 'starting' | 'running' | 'blocked' | 'completed' | 'failed'
  blockedReason: t.text(),
  branch: t.text(), // The git branch created for this task run
  forgegraphRevisionId: t.text(), // VCS revision ID (commit SHA or jj change ID) for ForgeGraph tracking
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));

export const CreateTaskRunSchema = createInsertSchema(taskRuns, {
  planningWorkspaceId: z.string(),
  planningItemId: z.string(),
  planningItemIdentifier: z.string(),
  workItemIdentifierSnapshot: z.string().optional(),
  status: z.enum(taskRunStatusEnum),
  blockedReason: z.string().optional(),
  branch: z.string().optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export const comments = pgTable("comments", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  parentId: t.uuid(),
  body: t.text().notNull(),
  bodyHtml: t.text(),
  edited: t.boolean().notNull().default(false),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateCommentSchema = createInsertSchema(comments, {
  body: z.string().min(1).max(10000),
  bodyHtml: z.string().optional(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const activities = pgTable("activities", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  userId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemActivityTypeEnum().notNull(),
  fromValue: t.text(),
  toValue: t.text(),
  metadata: t.json().$type<Record<string, unknown>>(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const workItemArtifacts = pgTable("work_item_artifacts", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
  producerType: workItemArtifactProducerTypeEnum().notNull(),
  producerId: t.text(),
  artifactType: workItemArtifactTypeEnum().notNull(),
  artifactRole: t.text().notNull(),
  url: t.text().notNull(),
  title: t.text(),
  summary: t.text(),
  metadata: t.json().$type<Record<string, unknown>>(),
  isCurrent: t.boolean().notNull().default(true),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateWorkItemArtifactSchema = createInsertSchema(
  workItemArtifacts,
  {
    producerType: z.enum(workItemArtifactProducerType),
    artifactType: z.enum(workItemArtifactType),
    artifactRole: z.string().min(1),
    url: z.string().url(),
    title: z.string().optional(),
    summary: z.string().optional(),
  },
).omit({
  id: true,
  createdAt: true,
});

export const notifications = pgTable("notifications", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workItemId: t
    .uuid()
    .references(() => workItems.id, { onDelete: "cascade" }),
  actorId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemNotificationTypeEnum().notNull(),
  title: t.text().notNull(),
  body: t.text(),
  url: t.text(),
  read: t.boolean().notNull().default(false),
  readAt: t.timestamp({ mode: "date", withTimezone: true }),
  archivedAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateNotificationSchema = createInsertSchema(notifications, {
  type: z.enum(workItemNotificationType),
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  url: z.string().url().optional(),
}).omit({
  id: true,
  read: true,
  readAt: true,
  archivedAt: true,
  createdAt: true,
});

// 6.1a Device Push Tokens (for mobile notifications)
export const devicePushTokens = pgTable("device_push_tokens", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceType: t.varchar({ length: 20 }).notNull(), // 'ios' | 'android' | 'web'
  expoPushToken: t.text().notNull(),
  deviceName: t.text(),
  enabled: t.boolean().notNull().default(true),
  lastSeenAt: t.timestamp({ mode: "date", withTimezone: true }),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const CreateDevicePushTokenSchema = createInsertSchema(
  devicePushTokens,
  {
    deviceType: z.enum(["ios", "android", "web"]),
    expoPushToken: z.string(),
    deviceName: z.string().optional(),
    enabled: z.boolean().default(true),
  },
).omit({
  id: true,
  userId: true,
  createdAt: true,
  lastSeenAt: true,
});

// =============================================================================
// Relations for GitHub Integration Tables
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

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  user: one(user, {
    fields: [taskRuns.userId],
    references: [user.id],
  }),
  session: one(chatConversations, {
    fields: [taskRuns.sessionId],
    references: [chatConversations.id],
  }),
  workItem: one(workItems, {
    fields: [taskRuns.workItemId],
    references: [workItems.id],
  }),
  repository: one(repositories, {
    fields: [taskRuns.repositoryId],
    references: [repositories.id],
  }),
  worktree: one(worktrees, {
    fields: [taskRuns.worktreeId],
    references: [worktrees.id],
  }),
  pullRequest: one(pullRequests, {
    fields: [taskRuns.pullRequestId],
    references: [pullRequests.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  workItem: one(workItems, {
    fields: [comments.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [comments.userId],
    references: [user.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  workItem: one(workItems, {
    fields: [activities.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [activities.userId],
    references: [user.id],
  }),
}));

export const workItemArtifactsRelations = relations(
  workItemArtifacts,
  ({ one }) => ({
    workItem: one(workItems, {
      fields: [workItemArtifacts.workItemId],
      references: [workItems.id],
    }),
    taskRun: one(taskRuns, {
      fields: [workItemArtifacts.taskRunId],
      references: [taskRuns.id],
    }),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
  workItem: one(workItems, {
    fields: [notifications.workItemId],
    references: [workItems.id],
  }),
  actor: one(user, {
    fields: [notifications.actorId],
    references: [user.id],
  }),
}));

export const devicePushTokensRelations = relations(
  devicePushTokens,
  ({ one }) => ({
    user: one(user, {
      fields: [devicePushTokens.userId],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// ForgeGraph Tables (revisions, builds, deployments, run events)
// =============================================================================

export const forgeRevisionStatusEnum = ["open", "merged", "abandoned"] as const;

export const forgeRevisions = pgTable(
  "forge_revisions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revId: t.text().notNull(), // commit SHA or JJ changeset ID
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    branch: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("open"),
    gates: t.json().$type<Array<{ name: string; status: string; startedAt?: string; finishedAt?: string }>>().default([]),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_revisions_repo_idx", columns: [table.repoId] },
    { name: "forge_revisions_task_idx", columns: [table.taskId] },
    { name: "forge_revisions_repo_rev_idx", columns: [table.repoId, table.revId], unique: true },
  ],
);

export const forgeBuildStatusEnum = ["queued", "running", "passed", "failed", "canceled", "superseded"] as const;

export const forgeBuilds = pgTable(
  "forge_builds",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    idempotencyKey: t.text().notNull(),
    ciProvider: t.text(),
    externalJobId: t.text(),
    imageDigest: t.text(),
    artifactManifestRef: t.text(),
    durationMs: t.integer(),
    startedAt: t.timestamp({ mode: "date", withTimezone: true }),
    finishedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_builds_revision_idx", columns: [table.revisionId] },
    { name: "forge_builds_idempotency_idx", columns: [table.idempotencyKey], unique: true },
  ],
);

export const forgeDeploymentEnvEnum = ["dev", "staging", "prod", "preview"] as const;
export const forgeDeploymentStatusEnum = ["pending_approval", "deploying", "healthy", "unhealthy", "rolled_back", "failed"] as const;

export const forgeDeployments = pgTable(
  "forge_deployments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    buildId: t.uuid().notNull().references(() => forgeBuilds.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    status: t.varchar({ length: 30 }).notNull().default("pending_approval"),
    rollbackTargetId: t.uuid(), // self-ref to another forgeDeployments.id
    deployedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "date", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_deployments_revision_idx", columns: [table.revisionId] },
    { name: "forge_deployments_env_idx", columns: [table.repoId, table.environment] },
  ],
);

export const forgeRunEventTypeEnum = ["created", "patch_applied", "tests_started", "tests_finished", "approved", "integrated", "failed"] as const;

export const forgeRunEvents = pgTable(
  "forge_run_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t.text().notNull(), // Bob taskRunId
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    agentId: t.uuid(), // chatConversation session ID
    eventType: t.varchar({ length: 30 }).notNull(),
    testStatus: t.text(),
    artifactRefs: t.json().$type<Array<{ type: string; url?: string; description?: string }>>().default([]),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    { name: "forge_run_events_run_idx", columns: [table.runId] },
    { name: "forge_run_events_revision_idx", columns: [table.revisionId] },
  ],
);

// ForgeGraph Relations

export const forgeRevisionsRelations = relations(
  forgeRevisions,
  ({ one, many }) => ({
    repository: one(repositories, {
      fields: [forgeRevisions.repoId],
      references: [repositories.id],
    }),
    task: one(workItems, {
      fields: [forgeRevisions.taskId],
      references: [workItems.id],
    }),
    taskRun: one(taskRuns, {
      fields: [forgeRevisions.taskRunId],
      references: [taskRuns.id],
    }),
    builds: many(forgeBuilds),
    deployments: many(forgeDeployments),
    runEvents: many(forgeRunEvents),
  }),
);

export const forgeBuildsRelations = relations(
  forgeBuilds,
  ({ one, many }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeBuilds.revisionId],
      references: [forgeRevisions.id],
    }),
    deployments: many(forgeDeployments),
  }),
);

export const forgeDeploymentsRelations = relations(
  forgeDeployments,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeDeployments.revisionId],
      references: [forgeRevisions.id],
    }),
    build: one(forgeBuilds, {
      fields: [forgeDeployments.buildId],
      references: [forgeBuilds.id],
    }),
  }),
);

export const forgeRunEventsRelations = relations(
  forgeRunEvents,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeRunEvents.revisionId],
      references: [forgeRevisions.id],
    }),
  }),
);

// ── Skills ──────────────────────────────────────────────────────────────────

export const skillCategory = [
  "planning",
  "execution",
  "review",
  "deploy",
  "ops",
  "other",
] as const;
export type SkillCategory = (typeof skillCategory)[number];
export const skillCategoryEnum = pgEnum("skill_category", skillCategory);

export const skillSource = ["builtin", "gstack", "custom"] as const;
export type SkillSource = (typeof skillSource)[number];
export const skillSourceEnum = pgEnum("skill_source", skillSource);

export const skillExecutionStatus = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SkillExecutionStatus = (typeof skillExecutionStatus)[number];
export const skillExecutionStatusEnum = pgEnum(
  "skill_execution_status",
  skillExecutionStatus,
);

export const skills = pgTable("skills", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.text().notNull(),
  slug: t.text().notNull().unique(),
  description: t.text(),
  category: skillCategoryEnum().notNull().default("other"),
  source: skillSourceEnum().notNull().default("builtin"),
  version: t.text(),
  configSchema: t.jsonb().notNull().default({}),
  isActive: t.boolean().notNull().default(true),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  executions: many(skillExecutions),
}));

export const skillExecutions = pgTable(
  "skill_executions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .references(() => chatConversations.id, { onDelete: "set null" }),
    skillId: t
      .uuid()
      .references(() => skills.id, { onDelete: "set null" }),
    skillSlug: t.text().notNull(),
    workItemId: t
      .uuid()
      .references(() => workItems.id, { onDelete: "set null" }),
    parentExecutionId: t.uuid(),
    status: skillExecutionStatusEnum().notNull().default("running"),
    input: t.jsonb().notNull().default({}),
    output: t.jsonb().notNull().default({}),
    findings: t.jsonb().notNull().default([]),
    durationMs: t.integer(),
    startedAt: t.timestamp().defaultNow().notNull(),
    completedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t.timestamp().defaultNow().notNull(),
  }),
  (table) => [
    index("skill_executions_skill_slug_idx").on(table.skillSlug),
    index("skill_executions_session_id_idx").on(table.sessionId),
    index("skill_executions_work_item_id_idx").on(table.workItemId),
    index("skill_executions_parent_execution_id_idx").on(
      table.parentExecutionId,
    ),
  ],
);

export const skillExecutionsRelations = relations(
  skillExecutions,
  ({ one }) => ({
    skill: one(skills, {
      fields: [skillExecutions.skillId],
      references: [skills.id],
    }),
    session: one(chatConversations, {
      fields: [skillExecutions.sessionId],
      references: [chatConversations.id],
    }),
    workItem: one(workItems, {
      fields: [skillExecutions.workItemId],
      references: [workItems.id],
    }),
    parentExecution: one(skillExecutions, {
      fields: [skillExecutions.parentExecutionId],
      references: [skillExecutions.id],
    }),
  }),
);

export * from "./auth-schema";
