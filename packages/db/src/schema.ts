import { relations, sql } from "drizzle-orm";
import { pgEnum, pgTable } from "drizzle-orm/pg-core";
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
  kanbangerProjectId: t.text(),
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
    kanbangerTaskId: t.text(),
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
      columns: [table.kanbangerTaskId],
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
  }),
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, {
    fields: [chatMessages.conversationId],
    references: [chatConversations.id],
  }),
}));

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
  "kanbanger_task",
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
  kanbangerTaskId: t.varchar({ length: 100 }),
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
  kanbangerTaskId: z.string().max(100).optional(),
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
  kanbangerTaskId: t.text(),
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
  kanbangerTaskId: z.string().optional(),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  mergedAt: true,
  closedAt: true,
});

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
  provider: t.varchar({ length: 20 }).notNull(), // 'github' | 'gitlab' | 'gitea' | 'kanbanger'
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

// 1.5 Task Runs (Kanbanger execution tracking)
export const taskRuns = pgTable("task_runs", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  kanbangerWorkspaceId: t.text().notNull(),
  kanbangerIssueId: t.text().notNull(),
  kanbangerIssueIdentifier: t.text().notNull(), // e.g., "PROJ-123"
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
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
}));

export const CreateTaskRunSchema = createInsertSchema(taskRuns, {
  kanbangerWorkspaceId: z.string(),
  kanbangerIssueId: z.string(),
  kanbangerIssueIdentifier: z.string(),
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

export * from "./auth-schema";
