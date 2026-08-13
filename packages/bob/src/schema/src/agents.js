"use strict";
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
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionCheckpointsRelations = exports.sessionConnectionsRelations = exports.sessionEventsRelations = exports.skillExecutionsRelations = exports.skillsRelations = exports.runLifecycleEventsRelations = exports.runArtifactsRelations = exports.agentRunsRelations = exports.agentInstancesRelations = exports.sessionCheckpoints = exports.skillExecutions = exports.skills = exports.skillExecutionStatusEnum = exports.skillExecutionStatus = exports.skillSourceEnum = exports.skillSource = exports.skillCategoryEnum = exports.skillCategory = exports.runLifecycleEvents = exports.runnerLeasesRelations = exports.runnerLeases = exports.sessionConnections = exports.deviceTypeEnum = exports.sessionEvents = exports.sessionEventTypeEnum = exports.sessionEventDirectionEnum = exports.workflowStatusEnum = exports.sessionStatusEnum = exports.messageRoleEnum = exports.dailyUsageStats = exports.instanceUsageSummary = exports.tokenUsageSessions = exports.CreateAgentInstanceSchema = exports.agentInstances = exports.runArtifacts = exports.runArtifactTypeEnum = exports.agentRuns = exports.agentRunStatusEnum = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
var tenancy_js_1 = require("./tenancy.js");
var projects_js_1 = require("./projects.js");
var work_items_js_1 = require("./work-items.js");
var chat_js_1 = require("./chat.js");
// agentTypeEnum / instanceStatusEnum are canonically defined in
// @bob/projects/schema. We duplicate the literal arrays here to break the
// binding-level cycle: agents → projects → agents (projects imports
// agentInstances for its relations). The values MUST stay in sync.
var agentTypeEnum = [
    "claude",
    "kiro",
    "codex",
    "gemini",
    "grok",
    "opencode",
    "smol-agent",
    "cursor-agent",
    "elevenlabs",
];
var instanceStatusEnum = [
    "running",
    "stopped",
    "starting",
    "error",
];
// --- Agent Runs ---
exports.agentRunStatusEnum = (0, pg_core_1.pgEnum)("agent_run_status", [
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
exports.agentRuns = (0, pg_core_1.pgTable)("agent_runs", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t.uuid("session_id").references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "set null" }),
    workItemId: t.text("work_item_id"),
    workspaceId: t
        .uuid("workspace_id")
        .notNull()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    tenantId: t
        .uuid("tenant_id")
        .notNull()
        .references(function () { return tenancy_js_1.tenants.id; }, { onDelete: "cascade" }),
    agentType: t.varchar("agent_type", { length: 64 }).notNull(),
    agentConfig: t.json("agent_config").$type(),
    // Immutable dispatch specification captured at dispatch time. Retry
    // re-dispatches from this verbatim; it is never updated after insert.
    dispatchSpec: t.json("dispatch_spec").$type(),
    status: (0, exports.agentRunStatusEnum)("status").notNull().default("queued"),
    startedAt: t.timestamp("started_at"),
    completedAt: t.timestamp("completed_at"),
    summary: t.json("summary").$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("agent_runs_workspace_idx").on(table.workspaceId),
    (0, pg_core_1.index)("agent_runs_tenant_idx").on(table.tenantId),
    (0, pg_core_1.index)("agent_runs_work_item_idx").on(table.workItemId),
    (0, pg_core_1.index)("agent_runs_session_idx").on(table.sessionId),
]; });
exports.runArtifactTypeEnum = (0, pg_core_1.pgEnum)("run_artifact_type", [
    "diff",
    "log",
    "test-report",
    "file-snapshot",
]);
exports.runArtifacts = (0, pg_core_1.pgTable)("run_artifacts", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t
        .uuid("run_id")
        .notNull()
        .references(function () { return exports.agentRuns.id; }, { onDelete: "cascade" }),
    type: (0, exports.runArtifactTypeEnum)("type").notNull(),
    storageKey: t.text("storage_key").notNull(),
    metadata: t.json("metadata").$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [(0, pg_core_1.index)("run_artifacts_run_idx").on(table.runId)]; });
// --- Agent Instances ---
exports.agentInstances = (0, pg_core_1.pgTable)("agent_instances", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    worktreeId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.worktrees.id; }, { onDelete: "cascade" }),
    agentType: t.varchar({ length: 50 }).notNull().default("claude"),
    status: t.varchar({ length: 20 }).notNull().default("stopped"),
    pid: t.integer(),
    port: t.integer(),
    errorMessage: t.text(),
    lastActivity: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateAgentInstanceSchema = (0, drizzle_zod_1.createInsertSchema)(exports.agentInstances, {
    agentType: v4_1.z.enum(agentTypeEnum).default("claude"),
    status: v4_1.z.enum(instanceStatusEnum).default("stopped"),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
});
// --- Token Usage ---
exports.tokenUsageSessions = (0, pg_core_1.pgTable)("token_usage_sessions", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    instanceId: t
        .uuid()
        .notNull()
        .references(function () { return exports.agentInstances.id; }, { onDelete: "cascade" }),
    worktreeId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.worktrees.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    inputTokens: t.integer().notNull().default(0),
    outputTokens: t.integer().notNull().default(0),
    cacheReadTokens: t.integer().notNull().default(0),
    cacheCreationTokens: t.integer().notNull().default(0),
    totalCostUsd: t.numeric({ precision: 10, scale: 6 }).notNull().default("0"),
    sessionStart: t.timestamp({ mode: "string" }).notNull(),
    sessionEnd: t.timestamp({ mode: "string" }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.instanceUsageSummary = (0, pg_core_1.pgTable)("instance_usage_summary", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    instanceId: t
        .uuid()
        .notNull()
        .unique()
        .references(function () { return exports.agentInstances.id; }, { onDelete: "cascade" }),
    worktreeId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.worktrees.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "cascade" }),
    totalInputTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalOutputTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCacheReadTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCacheCreationTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCostUsd: t.numeric({ precision: 12, scale: 6 }).notNull().default("0"),
    sessionCount: t.integer().notNull().default(0),
    firstUsage: t.timestamp({ mode: "string" }).notNull(),
    lastUsage: t.timestamp({ mode: "string" }).notNull(),
}); });
exports.dailyUsageStats = (0, pg_core_1.pgTable)("daily_usage_stats", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    date: t.date().notNull().unique(),
    totalInputTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalOutputTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCacheReadTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCacheCreationTokens: t.bigint({ mode: "number" }).notNull().default(0),
    totalCostUsd: t.numeric({ precision: 12, scale: 6 }).notNull().default("0"),
    sessionCount: t.integer().notNull().default(0),
    activeInstances: t.integer().notNull().default(0),
}); });
// --- Const-array enums (used by agent sessions / messaging) ---
exports.messageRoleEnum = ["user", "assistant", "system", "tool"];
exports.sessionStatusEnum = [
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
];
exports.workflowStatusEnum = [
    "started",
    "working",
    "awaiting_input",
    "blocked",
    "awaiting_review",
    "completed",
];
// --- Session Events ---
exports.sessionEventDirectionEnum = ["client", "agent", "system"];
exports.sessionEventTypeEnum = [
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
];
exports.sessionEvents = (0, pg_core_1.pgTable)("session_events", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    seq: t.bigint({ mode: "number" }).notNull(),
    // Runner-assigned monotonic per-session send sequence. NULL for
    // gateway-originated events (sweeps, errors). Ingest dedups on this:
    // at-least-once redelivery from the runner's disk buffer must not
    // produce a second row. Postgres unique ignores NULLs, so
    // gateway-originated events are unconstrained.
    sendSeq: t.bigint("send_seq", { mode: "number" }),
    direction: t.varchar({ length: 20 }).notNull(),
    eventType: t.varchar({ length: 30 }).notNull(),
    payload: t.json().$type().notNull().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    {
        // Non-unique: production has historical duplicate (session_id, seq) rows
        // (pre-dating the atomic nextSeq increment), so this is a lookup index for
        // the replay query, not a uniqueness constraint. Ingest dedup is enforced
        // by the (session_id, send_seq) unique index below.
        name: "session_events_session_seq_idx",
        columns: [table.sessionId, table.seq],
    },
    {
        name: "session_events_session_send_seq_unique",
        columns: [table.sessionId, table.sendSeq],
        unique: true,
    },
]; });
// --- Session Connections ---
exports.deviceTypeEnum = [
    "web",
    "ios",
    "android",
    "desktop",
    "other",
];
exports.sessionConnections = (0, pg_core_1.pgTable)("session_connections", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    clientId: t.text().notNull(),
    deviceType: t.varchar({ length: 20 }).notNull().default("web"),
    connectedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    disconnectedAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastSeenAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastAckSeq: t.bigint({ mode: "number" }).notNull().default(0),
    ip: t.text(),
    userAgent: t.text(),
}); });
// --- Runner Leases ---
// Host/connector identity for liveness. Only the runner's own heartbeat may
// update lastHeartbeatAt — workspaces.lastHeartbeat has multiple writers, so
// a healthy non-runner writer could mask a dead runner. One row per
// (workspace, host); connectorInstanceId changes on every runner restart so
// adoption logic can tell a restarted runner from a reconnected one.
exports.runnerLeases = (0, pg_core_1.pgTable)("runner_leases", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workspaceId: t
        .uuid()
        .notNull()
        .references(function () { return tenancy_js_1.workspaces.id; }, { onDelete: "cascade" }),
    hostId: t.text().notNull(),
    connectorInstanceId: t.text().notNull(),
    daemonVersion: t.text(),
    startedAt: t.timestamp({ mode: "string", withTimezone: true }).defaultNow().notNull(),
    lastHeartbeatAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .defaultNow()
        .notNull(),
}); }, function (table) { return [
    {
        name: "runner_leases_workspace_host_unique",
        columns: [table.workspaceId, table.hostId],
        unique: true,
    },
]; });
exports.runnerLeasesRelations = (0, drizzle_orm_1.relations)(exports.runnerLeases, function (_a) {
    var one = _a.one;
    return ({
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.runnerLeases.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
    });
});
// --- Run Lifecycle Events ---
exports.runLifecycleEvents = (0, pg_core_1.pgTable)("run_lifecycle_events", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    taskRunId: t
        .uuid()
        .notNull()
        .references(function () { return work_items_js_1.taskRuns.id; }, { onDelete: "cascade" }),
    workItemId: t
        .uuid()
        .references(function () { return work_items_js_1.workItems.id; }, { onDelete: "set null" }),
    sessionId: t
        .uuid()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "set null" }),
    eventType: t.varchar({ length: 40 }).notNull(),
    phase: t.varchar({ length: 20 }).notNull(),
    metadata: t.json().$type().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    { name: "run_lifecycle_events_run_idx", columns: [table.taskRunId] },
    { name: "run_lifecycle_events_type_idx", columns: [table.eventType] },
]; });
// --- Skills ---
exports.skillCategory = [
    "planning",
    "execution",
    "review",
    "deploy",
    "ops",
    "other",
];
exports.skillCategoryEnum = (0, pg_core_1.pgEnum)("skill_category", exports.skillCategory);
exports.skillSource = ["builtin", "gstack", "custom"];
exports.skillSourceEnum = (0, pg_core_1.pgEnum)("skill_source", exports.skillSource);
exports.skillExecutionStatus = [
    "running",
    "completed",
    "failed",
    "cancelled",
];
exports.skillExecutionStatusEnum = (0, pg_core_1.pgEnum)("skill_execution_status", exports.skillExecutionStatus);
exports.skills = (0, pg_core_1.pgTable)("skills", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    name: t.text().notNull(),
    slug: t.text().notNull().unique(),
    description: t.text(),
    category: (0, exports.skillCategoryEnum)().notNull().default("other"),
    source: (0, exports.skillSourceEnum)().notNull().default("builtin"),
    version: t.text(),
    configSchema: t.jsonb().notNull().default({}),
    isActive: t.boolean().notNull().default(true),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.skillExecutions = (0, pg_core_1.pgTable)("skill_executions", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "set null" }),
    skillId: t
        .uuid()
        .references(function () { return exports.skills.id; }, { onDelete: "set null" }),
    skillSlug: t.text().notNull(),
    workItemId: t
        .uuid()
        .references(function () { return work_items_js_1.workItems.id; }, { onDelete: "set null" }),
    parentExecutionId: t.uuid(),
    status: (0, exports.skillExecutionStatusEnum)().notNull().default("running"),
    input: t.jsonb().notNull().default({}),
    output: t.jsonb().notNull().default({}),
    findings: t.jsonb().notNull().default([]),
    durationMs: t.integer(),
    startedAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    completedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("skill_executions_skill_slug_idx").on(table.skillSlug),
    (0, pg_core_1.index)("skill_executions_session_id_idx").on(table.sessionId),
    (0, pg_core_1.index)("skill_executions_work_item_id_idx").on(table.workItemId),
    (0, pg_core_1.index)("skill_executions_parent_execution_id_idx").on(table.parentExecutionId),
]; });
// --- Session Checkpoints ---
exports.sessionCheckpoints = (0, pg_core_1.pgTable)("session_checkpoints", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    turnNumber: t.integer().notNull(),
    eventSeq: t.integer().notNull(),
    label: t.text(),
    snapshotData: t.jsonb().notNull().default({}),
    gitRef: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [(0, pg_core_1.index)("session_checkpoints_session_id_idx").on(table.sessionId)]; });
// =============================================================================
// Relations
// =============================================================================
exports.agentInstancesRelations = (0, drizzle_orm_1.relations)(exports.agentInstances, function (_a) {
    var one = _a.one;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.agentInstances.userId],
            references: [auth_js_1.user.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.agentInstances.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        worktree: one(projects_js_1.worktrees, {
            fields: [exports.agentInstances.worktreeId],
            references: [projects_js_1.worktrees.id],
        }),
    });
});
exports.agentRunsRelations = (0, drizzle_orm_1.relations)(exports.agentRuns, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        session: one(chat_js_1.chatConversations, {
            fields: [exports.agentRuns.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.agentRuns.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
        tenant: one(tenancy_js_1.tenants, {
            fields: [exports.agentRuns.tenantId],
            references: [tenancy_js_1.tenants.id],
        }),
        artifacts: many(exports.runArtifacts),
    });
});
exports.runArtifactsRelations = (0, drizzle_orm_1.relations)(exports.runArtifacts, function (_a) {
    var one = _a.one;
    return ({
        run: one(exports.agentRuns, {
            fields: [exports.runArtifacts.runId],
            references: [exports.agentRuns.id],
        }),
    });
});
exports.runLifecycleEventsRelations = (0, drizzle_orm_1.relations)(exports.runLifecycleEvents, function (_a) {
    var one = _a.one;
    return ({
        taskRun: one(work_items_js_1.taskRuns, {
            fields: [exports.runLifecycleEvents.taskRunId],
            references: [work_items_js_1.taskRuns.id],
        }),
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.runLifecycleEvents.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.runLifecycleEvents.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
exports.skillsRelations = (0, drizzle_orm_1.relations)(exports.skills, function (_a) {
    var many = _a.many;
    return ({
        executions: many(exports.skillExecutions),
    });
});
exports.skillExecutionsRelations = (0, drizzle_orm_1.relations)(exports.skillExecutions, function (_a) {
    var one = _a.one;
    return ({
        skill: one(exports.skills, {
            fields: [exports.skillExecutions.skillId],
            references: [exports.skills.id],
        }),
        session: one(chat_js_1.chatConversations, {
            fields: [exports.skillExecutions.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.skillExecutions.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        parentExecution: one(exports.skillExecutions, {
            fields: [exports.skillExecutions.parentExecutionId],
            references: [exports.skillExecutions.id],
        }),
    });
});
// =============================================================================
// Cross-cutting relations — tables that FK-reference chatConversations.
// Moved from @bob/db/schema in Task 14 (previously kept there as cross-cutting
// because chatConversations was still inline in the monolith).
// =============================================================================
exports.sessionEventsRelations = (0, drizzle_orm_1.relations)(exports.sessionEvents, function (_a) {
    var one = _a.one;
    return ({
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionEvents.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
exports.sessionConnectionsRelations = (0, drizzle_orm_1.relations)(exports.sessionConnections, function (_a) {
    var one = _a.one;
    return ({
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionConnections.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.sessionConnections.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.sessionCheckpointsRelations = (0, drizzle_orm_1.relations)(exports.sessionCheckpoints, function (_a) {
    var one = _a.one;
    return ({
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionCheckpoints.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
var templateObject_1;
