// =============================================================================
// @bob/agents/schema — Agent instances, runs, token usage, sessions, skills,
// and lifecycle events.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 13):
//   - agentRuns + agentRunStatusEnum
//   - runArtifacts + runArtifactTypeEnum
//   - agentInstances + CreateAgentInstanceSchema
//   - tokenUsageSessions
//   - instanceUsageSummary
//   - dailyUsageStats
//   - sessionEvents + sessionEventDirectionEnum + SessionEventDirection
//     + sessionEventTypeEnum + SessionEventType
//   - sessionConnections + deviceTypeEnum + DeviceType
//   - runLifecycleEvents
//   - sessionCheckpoints
//   - skills + skillCategory/SkillCategory/skillCategoryEnum
//     + skillSource/SkillSource/skillSourceEnum
//     + skillExecutionStatus/SkillExecutionStatus/skillExecutionStatusEnum
//   - skillExecutions
//
// Const-array enums:
//   - messageRoleEnum + MessageRole
//   - sessionStatusEnum + SessionStatus
//   - workflowStatusEnum + WorkflowStatus
//
// Cross-area imports:
//   - user from @bob/auth/schema
//   - tenants, workspaces from @bob/tenancy/schema
//   - repositories, worktrees from @bob/projects/schema
//   - workItems, taskRuns from @bob/work-items/schema
//
// NOTE: chatConversations moved to @bob/chat/schema in Task 14.  The mutual
// dependency (chat → agents for agentInstances/sessionEvents/sessionConnections,
// agents → chat for chatConversations) is safe because both are
// declaration-only — pgTable/relations are lazy, not runtime-evaluated.
// =============================================================================

import { relations, sql } from "drizzle-orm";
import { index, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";
import { tenants, workspaces } from "@bob/tenancy/schema";
import {
  repositories,
  worktrees,
} from "@bob/projects/schema";
import { taskRuns, workItems } from "@bob/work-items/schema";
import { chatConversations } from "@bob/chat/schema";

// agentTypeEnum / instanceStatusEnum are canonically defined in
// @bob/projects/schema. We duplicate the literal arrays here to break the
// binding-level cycle: agents → projects → agents (projects imports
// agentInstances for its relations). The values MUST stay in sync.
const agentTypeEnum = [
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

const instanceStatusEnum = [
  "running",
  "stopped",
  "starting",
  "error",
] as const;

// --- Agent Runs ---

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  // Waiting on a human decision (permission request or re-auth). The run is
  // paused, not dead — silence never means failure.
  "blocked",
  "completed",
  "failed",
  "interrupted",
  // Heartbeat lease expired: contact lost, process fate unknown. Terminal
  // states take precedence over this on reconciliation.
  "host_unknown",
]);

export const agentRuns = pgTable(
  "agent_runs",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t.uuid("session_id").references(() => chatConversations.id, { onDelete: "set null" }),
    workItemId: t.text("work_item_id"),
    workspaceId: t
      .uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tenantId: t
      .uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentType: t.varchar("agent_type", { length: 64 }).notNull(),
    agentConfig: t.json("agent_config").$type<Record<string, unknown>>(),
    // Immutable dispatch specification captured at dispatch time. Retry
    // re-dispatches from this verbatim; it is never updated after insert.
    dispatchSpec: t.json("dispatch_spec").$type<{
      prompt: string;
      repositoryId?: string;
      worktreeConfig?: Record<string, unknown>;
      personaId?: string;
      model?: string;
      allowedTools?: string[];
    }>(),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    startedAt: t.timestamp("started_at"),
    completedAt: t.timestamp("completed_at"),
    summary: t.json("summary").$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("agent_runs_workspace_idx").on(table.workspaceId),
    index("agent_runs_tenant_idx").on(table.tenantId),
    index("agent_runs_work_item_idx").on(table.workItemId),
    index("agent_runs_session_idx").on(table.sessionId),
  ],
);

export const runArtifactTypeEnum = pgEnum("run_artifact_type", [
  "diff",
  "log",
  "test-report",
  "file-snapshot",
]);

export const runArtifacts = pgTable(
  "run_artifacts",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t
      .uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    type: runArtifactTypeEnum("type").notNull(),
    storageKey: t.text("storage_key").notNull(),
    metadata: t.json("metadata").$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [index("run_artifacts_run_idx").on(table.runId)],
);

// --- Agent Instances ---

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
  lastActivity: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "string", withTimezone: true })
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

// --- Token Usage ---

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
  sessionStart: t.timestamp({ mode: "string" }).notNull(),
  sessionEnd: t.timestamp({ mode: "string" }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
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
  firstUsage: t.timestamp({ mode: "string" }).notNull(),
  lastUsage: t.timestamp({ mode: "string" }).notNull(),
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

// --- Const-array enums (used by agent sessions / messaging) ---

export const messageRoleEnum = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof messageRoleEnum)[number];

export const sessionStatusEnum = [
  "provisioning",
  "starting",
  "running",
  // Paused on a human decision (permission request / re-auth).
  "blocked",
  "idle",
  "stopping",
  "stopped",
  "error",
  // Lease expired: contact lost, process fate unknown (never implies failure).
  "host_unknown",
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

// --- Session Events ---

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
  // Lifecycle events (exempt from buffer eviction and retention pruning):
  "permission_request",
  "permission_resolved",
  "status_change",
  // Marks a span of evicted output_chunk events in a partition buffer.
  "gap_marker",
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
    // Runner-assigned monotonic per-session send sequence. NULL for
    // gateway-originated events (sweeps, errors). Ingest dedups on this:
    // at-least-once redelivery from the runner's disk buffer must not
    // produce a second row. Postgres unique ignores NULLs, so
    // gateway-originated events are unconstrained.
    sendSeq: t.bigint("send_seq", { mode: "number" }),
    direction: t.varchar({ length: 20 }).notNull(),
    eventType: t.varchar({ length: 30 }).notNull(),
    payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    {
      name: "session_events_session_seq_unique",
      columns: [table.sessionId, table.seq],
      unique: true,
    },
    {
      name: "session_events_session_send_seq_unique",
      columns: [table.sessionId, table.sendSeq],
      unique: true,
    },
  ],
);

// --- Session Connections ---

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
  connectedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  disconnectedAt: t.timestamp({ mode: "string", withTimezone: true }),
  lastSeenAt: t.timestamp({ mode: "string", withTimezone: true }),
  lastAckSeq: t.bigint({ mode: "number" }).notNull().default(0),
  ip: t.text(),
  userAgent: t.text(),
}));

// --- Runner Leases ---
// Host/connector identity for liveness. Only the runner's own heartbeat may
// update lastHeartbeatAt — workspaces.lastHeartbeat has multiple writers, so
// a healthy non-runner writer could mask a dead runner. One row per
// (workspace, host); connectorInstanceId changes on every runner restart so
// adoption logic can tell a restarted runner from a reconnected one.

export const runnerLeases = pgTable(
  "runner_leases",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    hostId: t.text().notNull(),
    connectorInstanceId: t.text().notNull(),
    daemonVersion: t.text(),
    startedAt: t.timestamp({ mode: "string", withTimezone: true }).defaultNow().notNull(),
    lastHeartbeatAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    {
      name: "runner_leases_workspace_host_unique",
      columns: [table.workspaceId, table.hostId],
      unique: true,
    },
  ],
);

export const runnerLeasesRelations = relations(runnerLeases, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [runnerLeases.workspaceId],
    references: [workspaces.id],
  }),
}));

// --- Run Lifecycle Events ---

export const runLifecycleEvents = pgTable(
  "run_lifecycle_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    taskRunId: t
      .uuid()
      .notNull()
      .references(() => taskRuns.id, { onDelete: "cascade" }),
    workItemId: t
      .uuid()
      .references(() => workItems.id, { onDelete: "set null" }),
    sessionId: t
      .uuid()
      .references(() => chatConversations.id, { onDelete: "set null" }),
    eventType: t.varchar({ length: 40 }).notNull(),
    phase: t.varchar({ length: 20 }).notNull(),
    metadata: t.json().$type<Record<string, unknown>>().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    { name: "run_lifecycle_events_run_idx", columns: [table.taskRunId] },
    { name: "run_lifecycle_events_type_idx", columns: [table.eventType] },
  ],
);

// --- Skills ---

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
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
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
    startedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    completedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
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

// --- Session Checkpoints ---

export const sessionCheckpoints = pgTable(
  "session_checkpoints",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    turnNumber: t.integer().notNull(),
    eventSeq: t.integer().notNull(),
    label: t.text(),
    snapshotData: t.jsonb().notNull().default({}),
    gitRef: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [index("session_checkpoints_session_id_idx").on(table.sessionId)],
);

// =============================================================================
// Relations
// =============================================================================

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

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  session: one(chatConversations, {
    fields: [agentRuns.sessionId],
    references: [chatConversations.id],
  }),
  workspace: one(workspaces, {
    fields: [agentRuns.workspaceId],
    references: [workspaces.id],
  }),
  tenant: one(tenants, {
    fields: [agentRuns.tenantId],
    references: [tenants.id],
  }),
  artifacts: many(runArtifacts),
}));

export const runArtifactsRelations = relations(runArtifacts, ({ one }) => ({
  run: one(agentRuns, {
    fields: [runArtifacts.runId],
    references: [agentRuns.id],
  }),
}));

export const runLifecycleEventsRelations = relations(
  runLifecycleEvents,
  ({ one }) => ({
    taskRun: one(taskRuns, {
      fields: [runLifecycleEvents.taskRunId],
      references: [taskRuns.id],
    }),
    workItem: one(workItems, {
      fields: [runLifecycleEvents.workItemId],
      references: [workItems.id],
    }),
    session: one(chatConversations, {
      fields: [runLifecycleEvents.sessionId],
      references: [chatConversations.id],
    }),
  }),
);

export const skillsRelations = relations(skills, ({ many }) => ({
  executions: many(skillExecutions),
}));

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

// =============================================================================
// Cross-cutting relations — tables that FK-reference chatConversations.
// Moved from @bob/db/schema in Task 14 (previously kept there as cross-cutting
// because chatConversations was still inline in the monolith).
// =============================================================================

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

export const sessionCheckpointsRelations = relations(
  sessionCheckpoints,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [sessionCheckpoints.sessionId],
      references: [chatConversations.id],
    }),
  }),
);
