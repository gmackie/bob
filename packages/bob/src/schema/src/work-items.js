"use strict";
// =============================================================================
// @bob/work-items/schema — Work-items area: tables, enums, relations,
// insert/zod schemas + the existing API contract zod schemas.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 12):
//   - workItems
//   - planDrafts
//   - planDraftDependencies
//   - workItemDependencies
//   - dispatchBatches
//   - dispatchItems
//   - requirements
//   - planTaskItems
//   - taskRuns
//   - comments
//   - workItemArtifacts
//   - workItemSnapshots
//
// Enums colocated with the work-items area:
//   - workItemKind / WorkItemKind / workItemKindEnum
//   - workItemActivityType / WorkItemActivityType / workItemActivityTypeEnum
//   - workItemArtifactType / WorkItemArtifactType / workItemArtifactTypeEnum
//   - workItemNotificationType / WorkItemNotificationType /
//     workItemNotificationTypeEnum
//   - workItemArtifactProducerType (API-level — values diverge from the DB
//     pgEnum; see note below) + workItemArtifactProducerTypeEnum (DB pgEnum,
//     values inlined to avoid name collision)
//   - requirementCategory / RequirementCategory
//   - requirementStatus / RequirementStatus
//   - taskStatusEnum / TaskStatus
//   - taskRunStatusEnum / TaskRunStatus
//
// Cross-area FK references DROPPED in this move (re-add when target moves):
//   - planDrafts.sessionId → chatConversations.id (Task 14: chat)
//   - dispatchBatches.sessionId → chatConversations.id (Task 14: chat)
//   - taskRuns.sessionId → chatConversations.id (Task 14: chat)
//   - taskRuns.pullRequestId → pullRequests.id (Task 15: git) -- RE-ENABLED
//   - workItemArtifacts.sessionId → chatConversations.id (Task 14: chat)
// The columns themselves are preserved; only the runtime `.references()` link
// is removed. Postgres-side FKs are unchanged (driven by migrations).
//
// Cross-area RELATIONS commented out (re-add when target moves):
//   - planDraftsRelations.session → chatConversations (Task 14: chat)
//   - dispatchBatchesRelations.session → chatConversations (Task 14: chat)
//   - taskRunsRelations.session → chatConversations (Task 14: chat)
//   - taskRunsRelations.pullRequest → pullRequests (Task 15: git) -- RE-ENABLED
//
// NOTE: The mutual dep (work-items → git for pullRequests, git → work-items
// for workItems/taskRuns) is safe because both are declaration-only — pgTable/
// relations are lazy, not runtime-evaluated (same pattern as agents ↔ chat).
//
// Note on workItemArtifactProducerType: the API contract zod enum
// ("task_run" | "session" | "integration" | "manual") and the DB pgEnum
// ("bob" | "forgegraph" | "human" | "system") diverge. This predates the
// Task-12 move (see comment in api/router/workItems.ts). The API-level const
// keeps its name; the DB pgEnum is constructed from an inline literal.
// =============================================================================
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workItems = exports.listChildArtifactGroupsOutputSchema = exports.markNotificationAsReadOutputSchema = exports.createNotificationOutputSchema = exports.listNotificationsOutputSchema = exports.listCurrentArtifactsOutputSchema = exports.listActivitiesOutputSchema = exports.createArtifactOutputSchema = exports.createCommentOutputSchema = exports.listCommentsOutputSchema = exports.promoteToTaskOutputSchema = exports.updateWorkItemOutputSchema = exports.getWorkItemOutputSchema = exports.listWorkItemsOutputSchema = exports.markAllNotificationsAsReadOutputSchema = exports.markAllNotificationsAsReadInputSchema = exports.markNotificationAsReadInputSchema = exports.createNotificationInputSchema = exports.listNotificationsInputSchema = exports.listChildArtifactGroupsInputSchema = exports.listCurrentArtifactsInputSchema = exports.listActivitiesInputSchema = exports.createArtifactInputSchema = exports.createCommentInputSchema = exports.listCommentsInputSchema = exports.promoteToTaskInputSchema = exports.updateWorkItemInputSchema = exports.getWorkItemInputSchema = exports.workItemStatusCountsInputSchema = exports.listWorkItemsInputSchema = exports.notificationRecordSchema = exports.activityRecordSchema = exports.artifactRecordSchema = exports.commentRecordSchema = exports.workItemRecordSchema = exports.projectSummarySchema = exports.taskRunStatusEnum = exports.taskStatusEnum = exports.requirementStatus = exports.requirementCategory = exports.workItemActivityTypeEnum = exports.workItemActivityType = exports.workItemKindEnum = exports.workItemKind = exports.workItemArtifactProducerTypeEnum = exports.workItemNotificationTypeEnum = exports.workItemNotificationType = exports.workItemArtifactTypeEnum = exports.workItemArtifactType = exports.workItemArtifactProducerType = void 0;
exports.workItemSnapshotsRelations = exports.workItemArtifactsRelations = exports.commentsRelations = exports.taskRunsRelations = exports.planTaskItemsRelations = exports.requirementsRelations = exports.dispatchItemsRelations = exports.dispatchBatchesRelations = exports.workItemDependenciesRelations = exports.planDraftDependenciesRelations = exports.planDraftsRelations = exports.workItemsRelations = exports.workItemSnapshots = exports.CreateWorkItemArtifactSchema = exports.workItemArtifacts = exports.CreateCommentSchema = exports.comments = exports.CreateTaskRunSchema = exports.taskRuns = exports.CreatePlanTaskItemSchema = exports.planTaskItems = exports.requirements = exports.dispatchItems = exports.dispatchBatches = exports.workItemDependencies = exports.planDraftDependencies = exports.planDrafts = exports.CreateWorkItemSchema = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
var git_js_1 = require("./git.js");
var projects_js_1 = require("./projects.js");
var tenancy_js_1 = require("./tenancy.js");
// -----------------------------------------------------------------------------
// API contract zod helpers (existing — unchanged)
// -----------------------------------------------------------------------------
var dateTimeStringSchema = v4_1.z.string().datetime();
var metadataSchema = v4_1.z.record(v4_1.z.string(), v4_1.z.unknown()).nullable().optional();
// -----------------------------------------------------------------------------
// API contract enums (existing — unchanged)
//
// `workItemArtifactType` and `workItemNotificationType` happen to match the
// DB pgEnum value sets exactly, so a single declaration serves both.
// `workItemArtifactProducerType` (API) diverges from the DB pgEnum; the DB
// values are inlined into the pgEnum below.
// -----------------------------------------------------------------------------
exports.workItemArtifactProducerType = [
    "task_run",
    "session",
    "integration",
    "manual",
];
exports.workItemArtifactType = [
    "pr",
    "verification",
    "build",
    "test_report",
    "doc",
    "deliverable",
    "planning_doc",
    "code_review",
    "other",
];
exports.workItemArtifactTypeEnum = (0, pg_core_1.pgEnum)("work_item_artifact_type", exports.workItemArtifactType);
exports.workItemNotificationType = [
    "work_item_assigned",
    "work_item_commented",
    "work_item_needs_input",
    "work_item_review_ready",
    "task_completed",
    "batch_completed",
];
exports.workItemNotificationTypeEnum = (0, pg_core_1.pgEnum)("work_item_notification_type", exports.workItemNotificationType);
exports.workItemArtifactProducerTypeEnum = (0, pg_core_1.pgEnum)("work_item_artifact_producer_type", ["bob", "forgegraph", "human", "system"]);
// -----------------------------------------------------------------------------
// Work-item core enums (DB-level)
// -----------------------------------------------------------------------------
exports.workItemKind = ["issue", "epic", "task"];
exports.workItemKindEnum = (0, pg_core_1.pgEnum)("work_item_kind", exports.workItemKind);
exports.workItemActivityType = [
    "comment_added",
    "status_changed",
    "artifact_added",
    "notification_created",
    "build_status_changed",
    "deploy_status_changed",
    "planning_session_completed",
    "review_requested",
    "review_approved",
    "review_changes_requested",
];
exports.workItemActivityTypeEnum = (0, pg_core_1.pgEnum)("work_item_activity_type", exports.workItemActivityType);
// -----------------------------------------------------------------------------
// Requirements / task / task-run enums
// -----------------------------------------------------------------------------
exports.requirementCategory = [
    "data",
    "api",
    "ui",
    "infra",
    "test",
    "other",
];
exports.requirementStatus = ["pending", "in_progress", "done"];
exports.taskStatusEnum = [
    "pending",
    "in_progress",
    "completed",
    "cancelled",
];
exports.taskRunStatusEnum = [
    "starting",
    "running",
    "blocked",
    "completed",
    "failed",
];
// -----------------------------------------------------------------------------
// API contract zod schemas (existing — unchanged)
// -----------------------------------------------------------------------------
exports.projectSummarySchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    key: v4_1.z.string(),
    name: v4_1.z.string(),
})
    .passthrough();
exports.workItemRecordSchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    identifier: v4_1.z.string().optional(),
    title: v4_1.z.string(),
    description: v4_1.z.string().nullable().optional(),
    kind: v4_1.z.string(),
    status: v4_1.z.string(),
    priority: v4_1.z.string().optional(),
    agentTypeOverride: v4_1.z.string().nullable().optional(),
    queueSortOrder: v4_1.z.number().int().optional(),
    sequenceNumber: v4_1.z.number().int().nullable().optional(),
    projectId: v4_1.z.string().nullable().optional(),
    ownerUserId: v4_1.z.string().nullable().optional(),
    workspaceId: v4_1.z.string().nullable().optional(),
    parentId: v4_1.z.string().nullable().optional(),
    project: exports.projectSummarySchema.nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
    updatedAt: dateTimeStringSchema.optional(),
})
    .passthrough();
exports.commentRecordSchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    workItemId: v4_1.z.string(),
    userId: v4_1.z.string(),
    parentId: v4_1.z.string().nullable().optional(),
    body: v4_1.z.string(),
    bodyHtml: v4_1.z.string().nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
    updatedAt: dateTimeStringSchema.optional(),
})
    .passthrough();
exports.artifactRecordSchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    workItemId: v4_1.z.string(),
    taskRunId: v4_1.z.string().nullable().optional(),
    sessionId: v4_1.z.string().nullable().optional(),
    producerType: v4_1.z.string(),
    producerId: v4_1.z.string().nullable().optional(),
    artifactType: v4_1.z.string(),
    artifactRole: v4_1.z.string(),
    title: v4_1.z.string().nullable().optional(),
    summary: v4_1.z.string().nullable().optional(),
    content: v4_1.z.string().nullable().optional(),
    url: v4_1.z.string().nullable().optional(),
    isCurrent: v4_1.z.boolean().optional(),
    metadata: metadataSchema,
    createdAt: dateTimeStringSchema.optional(),
})
    .passthrough();
exports.activityRecordSchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    workItemId: v4_1.z.string(),
    userId: v4_1.z.string().nullable().optional(),
    type: v4_1.z.string(),
    fromValue: v4_1.z.string().nullable().optional(),
    toValue: v4_1.z.string().nullable().optional(),
    metadata: metadataSchema,
    createdAt: dateTimeStringSchema.optional(),
})
    .passthrough();
exports.notificationRecordSchema = v4_1.z
    .object({
    id: v4_1.z.string(),
    userId: v4_1.z.string(),
    workItemId: v4_1.z.string().nullable().optional(),
    actorId: v4_1.z.string().nullable().optional(),
    type: v4_1.z.string(),
    title: v4_1.z.string(),
    body: v4_1.z.string().nullable().optional(),
    url: v4_1.z.string().nullable().optional(),
    read: v4_1.z.boolean().optional(),
    readAt: dateTimeStringSchema.nullable().optional(),
    createdAt: dateTimeStringSchema.optional(),
})
    .passthrough();
exports.listWorkItemsInputSchema = v4_1.z.object({
    workspaceId: v4_1.z.string().uuid(),
    projectId: v4_1.z.string().uuid().optional(),
    parentId: v4_1.z.string().uuid().nullable().optional(),
    kind: v4_1.z.enum(["issue", "epic", "task"]).optional(),
    status: v4_1.z.string().optional(),
    // Multi-status filter. When present, takes precedence over `status`. Lets a
    // lane (e.g. the priority queue: backlog/todo/ready/draft) fetch only its own
    // statuses instead of slicing a recency-capped firehose of every item — the
    // bug where a workspace full of `in_review` items starved the backlog out of
    // the first 100 rows and every "what's next" view read 0.
    statuses: v4_1.z.array(v4_1.z.string()).optional(),
    limit: v4_1.z.number().min(1).max(100).default(50),
});
// Per-status counts for a workspace's work items. Cheap GROUP BY that is immune
// to the list cap, so lane cards / sidebar badges can show accurate totals
// (e.g. 329 in_review, 25 backlog) without fetching every row.
exports.workItemStatusCountsInputSchema = v4_1.z.object({
    workspaceId: v4_1.z.string().uuid(),
    kind: v4_1.z.enum(["issue", "epic", "task"]).optional(),
});
exports.getWorkItemInputSchema = v4_1.z.object({
    id: v4_1.z.string(),
});
exports.updateWorkItemInputSchema = v4_1.z
    .object({
    id: v4_1.z.string().uuid(),
    title: v4_1.z.string().min(1).max(256).optional(),
    description: v4_1.z.string().nullable().optional(),
    status: v4_1.z.string().min(1).max(128).optional(),
    priority: v4_1.z.string().min(1).max(128).optional(),
    // null clears the override (inherit project/workspace default).
    agentTypeOverride: v4_1.z.string().max(50).nullable().optional(),
})
    .refine(function (input) {
    return input.title !== undefined ||
        input.description !== undefined ||
        input.status !== undefined ||
        input.priority !== undefined ||
        input.agentTypeOverride !== undefined;
}, {
    message: "At least one editable field is required",
});
exports.promoteToTaskInputSchema = v4_1.z.object({
    id: v4_1.z.string().uuid(),
});
exports.listCommentsInputSchema = v4_1.z.object({
    workItemId: v4_1.z.string().uuid(),
});
exports.createCommentInputSchema = v4_1.z.object({
    workItemId: v4_1.z.string().uuid(),
    body: v4_1.z.string().min(1).max(10000),
    bodyHtml: v4_1.z.string().optional(),
    parentId: v4_1.z.string().uuid().optional(),
});
exports.createArtifactInputSchema = v4_1.z.object({
    workItemId: v4_1.z.string().uuid(),
    taskRunId: v4_1.z.string().uuid().optional(),
    sessionId: v4_1.z.string().uuid().optional(),
    producerType: v4_1.z.enum(exports.workItemArtifactProducerType),
    producerId: v4_1.z.string().optional(),
    artifactType: v4_1.z.enum(exports.workItemArtifactType),
    artifactRole: v4_1.z.string().min(1),
    url: v4_1.z.string().url().optional(),
    title: v4_1.z.string().optional(),
    summary: v4_1.z.string().optional(),
    content: v4_1.z.string().optional(),
    metadata: v4_1.z.record(v4_1.z.string(), v4_1.z.unknown()).optional(),
});
exports.listActivitiesInputSchema = v4_1.z.object({
    workItemId: v4_1.z.string().uuid(),
    limit: v4_1.z.number().min(1).max(100).default(50),
});
exports.listCurrentArtifactsInputSchema = v4_1.z.object({
    workItemId: v4_1.z.string().uuid(),
});
exports.listChildArtifactGroupsInputSchema = v4_1.z.object({
    parentWorkItemId: v4_1.z.string().uuid(),
});
exports.listNotificationsInputSchema = v4_1.z.object({
    unreadOnly: v4_1.z.boolean().default(false),
    limit: v4_1.z.number().min(1).max(100).default(50),
});
exports.createNotificationInputSchema = v4_1.z.object({
    userId: v4_1.z.string(),
    workItemId: v4_1.z.string().uuid().optional(),
    actorId: v4_1.z.string().optional(),
    type: v4_1.z.enum(exports.workItemNotificationType),
    title: v4_1.z.string().min(1).max(256),
    body: v4_1.z.string().optional(),
    url: v4_1.z.string().url().optional(),
});
exports.markNotificationAsReadInputSchema = v4_1.z.object({
    id: v4_1.z.string().uuid(),
});
exports.markAllNotificationsAsReadInputSchema = v4_1.z.object({});
exports.markAllNotificationsAsReadOutputSchema = v4_1.z.object({
    count: v4_1.z.number().int().nonnegative(),
});
exports.listWorkItemsOutputSchema = v4_1.z.array(exports.workItemRecordSchema);
exports.getWorkItemOutputSchema = v4_1.z
    .object({
    workItem: exports.workItemRecordSchema,
    currentArtifacts: v4_1.z.array(exports.artifactRecordSchema),
    childCount: v4_1.z.number().int().nonnegative(),
})
    .nullable();
exports.updateWorkItemOutputSchema = exports.workItemRecordSchema.nullable();
exports.promoteToTaskOutputSchema = exports.workItemRecordSchema.nullable();
exports.listCommentsOutputSchema = v4_1.z.array(exports.commentRecordSchema);
exports.createCommentOutputSchema = exports.commentRecordSchema;
exports.createArtifactOutputSchema = exports.artifactRecordSchema;
exports.listActivitiesOutputSchema = v4_1.z.array(exports.activityRecordSchema);
exports.listCurrentArtifactsOutputSchema = v4_1.z.array(exports.artifactRecordSchema);
exports.listNotificationsOutputSchema = v4_1.z.object({
    items: v4_1.z.array(exports.notificationRecordSchema),
});
exports.createNotificationOutputSchema = exports.notificationRecordSchema;
exports.markNotificationAsReadOutputSchema = exports.notificationRecordSchema.nullable();
exports.listChildArtifactGroupsOutputSchema = v4_1.z.array(v4_1.z.object({
    workItem: exports.workItemRecordSchema,
    artifacts: v4_1.z.array(exports.artifactRecordSchema),
}));
// =============================================================================
// Drizzle tables
// =============================================================================
exports.workItems = (0, pg_core_1.pgTable)("work_items", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    parentId: t.uuid(),
    ownerUserId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    assigneeUserId: t.text(),
    workspaceId: t.uuid(),
    projectId: t.uuid(),
    sequenceNumber: t.integer().notNull().default(0),
    queueSortOrder: t.integer().notNull().default(0),
    kind: (0, exports.workItemKindEnum)().notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text(),
    status: t.varchar({ length: 40 }).notNull().default("draft"),
    // Per-work-item agent override; top of the resolveAgentType hierarchy.
    // Nullable = inherit from project / workspace default.
    agentTypeOverride: t.varchar({ length: 50 }),
    externalId: t.text(),
    externalProvider: t.varchar({ length: 20 }),
    // Canonical link back to the source issue (e.g. a Linear issue URL) for
    // deep-linking from the work-item detail view.
    externalUrl: t.text(),
    sourceMetadata: t
        .jsonb()
        .$type()
        .notNull()
        .default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("work_items_external_provider_id_uidx")
        .on(table.externalProvider, table.externalId)
        .where((0, drizzle_orm_1.sql)(templateObject_2 || (templateObject_2 = __makeTemplateObject(["", " is not null and ", " is not null"], ["", " is not null and ", " is not null"])), table.externalProvider, table.externalId)),
]; });
exports.CreateWorkItemSchema = (0, drizzle_zod_1.createInsertSchema)(exports.workItems, {
    kind: v4_1.z.enum(exports.workItemKind),
    title: v4_1.z.string().max(256),
    status: v4_1.z.string().max(40).default("draft"),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
exports.planDrafts = (0, pg_core_1.pgTable)("plan_drafts", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
    sessionId: t.uuid().notNull(),
    workspaceId: t.uuid().notNull(),
    projectId: t.uuid().notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text(),
    kind: (0, exports.workItemKindEnum)().notNull().default("task"),
    priority: t.varchar({ length: 20 }).notNull().default("no_priority"),
    sortOrder: t.integer().notNull().default(0),
    status: t.varchar({ length: 20 }).notNull().default("draft"),
    // status: "draft" | "committed" | "discarded"
    // Per-draft gate (definition-of-done) + acceptance criteria the planner
    // agent may author; carried into planTaskItems.gate/acceptanceCriteria when
    // the plan is committed as a gated checklist (validated by gateSpecSchema at
    // the API boundary). Null = the checklist's default gate.
    gate: t.jsonb(),
    acceptanceCriteria: t.text(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_3 || (templateObject_3 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [{ name: "plan_drafts_session_idx", columns: [table.sessionId] }]; });
exports.planDraftDependencies = (0, pg_core_1.pgTable)("plan_draft_dependencies", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    draftId: t
        .uuid()
        .notNull()
        .references(function () { return exports.planDrafts.id; }, { onDelete: "cascade" }),
    dependsOnDraftId: t
        .uuid()
        .notNull()
        .references(function () { return exports.planDrafts.id; }, { onDelete: "cascade" }),
}); }, function (table) { return [
    {
        name: "plan_draft_deps_unique_idx",
        columns: [table.draftId, table.dependsOnDraftId],
        unique: true,
    },
]; });
exports.workItemDependencies = (0, pg_core_1.pgTable)("work_item_dependencies", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    dependsOnWorkItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    {
        name: "work_item_deps_unique_idx",
        columns: [table.workItemId, table.dependsOnWorkItemId],
        unique: true,
    },
]; });
// =============================================================================
// Dispatch Tables (batch execution of planning tasks)
// =============================================================================
exports.dispatchBatches = (0, pg_core_1.pgTable)("dispatch_batches", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
    sessionId: t.uuid(),
    workspaceId: t.text().notNull(),
    projectId: t.text().notNull(),
    status: t.varchar({ length: 20 }).notNull().default("pending"),
    // status: "pending" | "dispatching" | "running" | "completed" | "failed"
    concurrency: t.integer().notNull().default(2),
    totalTasks: t.integer().notNull().default(0),
    completedTasks: t.integer().notNull().default(0),
    failedTasks: t.integer().notNull().default(0),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_4 || (templateObject_4 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.dispatchItems = (0, pg_core_1.pgTable)("dispatch_items", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    batchId: t
        .uuid()
        .notNull()
        .references(function () { return exports.dispatchBatches.id; }, { onDelete: "cascade" }),
    planningTaskId: t.text().notNull(),
    planningTaskIdentifier: t.text().notNull(),
    title: t.text().notNull(),
    description: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    // status: "queued" | "blocked" | "running" | "completed" | "failed"
    blockedByItems: t.json().$type().default([]),
    // Array of dispatchItem IDs that must complete before this one starts
    taskRunId: t.uuid().references(function () { return exports.taskRuns.id; }, { onDelete: "set null" }),
    sortOrder: t.integer().notNull().default(0),
    pipelineState: t.varchar({ length: 30 }),
    planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_5 || (templateObject_5 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [{ name: "dispatch_items_batch_idx", columns: [table.batchId] }]; });
// =============================================================================
// Requirements
// =============================================================================
exports.requirements = (0, pg_core_1.pgTable)("requirements", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    category: t.text({ enum: exports.requirementCategory }).notNull().default("other"),
    description: t.text().notNull(),
    status: t.text({ enum: exports.requirementStatus }).notNull().default("pending"),
    linkedTaskId: t.uuid(),
    sortOrder: t.integer().notNull().default(0),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [(0, pg_core_1.index)("requirements_work_item_id_idx").on(table.workItemId)]; });
// =============================================================================
// Plan task items (worktree-plan-scoped tasks)
// =============================================================================
exports.planTaskItems = (0, pg_core_1.pgTable)("plan_task_items", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    planId: t
        .uuid()
        .notNull()
        .references(function () { return projects_js_1.worktreePlans.id; }, { onDelete: "cascade" }),
    taskKey: t.varchar({ length: 20 }).notNull(),
    content: t.text().notNull(),
    status: t.varchar({ length: 20 }).notNull().default("pending"),
    // Machine-checkable definition-of-done for this checklist item
    // (test/build/ci/reviewer/human). Validated by gateSpecSchema at the API
    // boundary; kept as untyped jsonb here to avoid a work-items→api dependency.
    // Null means "use the checklist's default gate".
    gate: t.jsonb(),
    // Human-readable acceptance criteria the reviewer-gate (and humans) judge
    // against. Authored during planning alongside the item's work.
    acceptanceCriteria: t.text(),
    // Reprompt/repair attempts spent on this item after a failed gate; the
    // advanceChecklist driver blocks the item once this exceeds the cap.
    gateAttempts: t.integer().notNull().default(0),
    // The agent session currently (or last) executing this item. The driver reads
    // its workflowStatus to tell "still working" from "finished its turn, ready to
    // gate". Plain uuid (no cross-package FK to chat schema).
    sessionId: t.uuid(),
    // Reported outcome of this item's gate for the current attempt, set by the
    // execution side once the agent + gate have run: "pass" | "fail" | null.
    gateOutcome: t.varchar({ length: 10 }),
    // For reviewer-kind gates: the review session dispatched to judge this item's
    // work. The driver reads that session's terminal outcome (finished-ok → pass,
    // failed → fail) to resolve gateOutcome. Reset alongside gateOutcome on repair.
    gateReviewSessionId: t.uuid(),
    priority: t.varchar({ length: 10 }).notNull().default("medium"),
    parentTaskKey: t.varchar({ length: 20 }),
    sortOrder: t.integer().notNull().default(0),
    completedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_6 || (templateObject_6 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreatePlanTaskItemSchema = (0, drizzle_zod_1.createInsertSchema)(exports.planTaskItems, {
    taskKey: v4_1.z.string().max(20),
    content: v4_1.z.string(),
    status: v4_1.z.enum(exports.taskStatusEnum).default("pending"),
    priority: v4_1.z.enum(["low", "medium", "high"]).default("medium"),
    parentTaskKey: v4_1.z.string().max(20).optional(),
    sortOrder: v4_1.z.number().int().default(0),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
});
// =============================================================================
// Task Runs (planning execution tracking)
// =============================================================================
exports.taskRuns = (0, pg_core_1.pgTable)("task_runs", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    planningWorkspaceId: t.text("kanbanger_workspace_id").notNull(),
    planningItemId: t.text("kanbanger_issue_id").notNull(),
    planningItemIdentifier: t.text("kanbanger_issue_identifier").notNull(), // e.g., "PROJ-123"
    workItemId: t.uuid().references(function () { return exports.workItems.id; }, { onDelete: "set null" }),
    workItemIdentifierSnapshot: t.text(),
    // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
    sessionId: t.uuid(),
    repositoryId: t
        .uuid()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "set null" }),
    worktreeId: t.uuid().references(function () { return projects_js_1.worktrees.id; }, { onDelete: "set null" }),
    pullRequestId: t
        .uuid()
        .references(function () { return git_js_1.pullRequests.id; }, { onDelete: "set null" }),
    status: t.varchar({ length: 20 }).notNull(), // 'starting' | 'running' | 'blocked' | 'completed' | 'failed'
    blockedReason: t.text(),
    branch: t.text(), // The git branch created for this task run
    forgegraphRevisionId: t.text(), // VCS revision ID (commit SHA or jj change ID) for ForgeGraph tracking
    parentTaskRunId: t
        .uuid()
        .references(function () { return exports.taskRuns.id; }, { onDelete: "set null" }),
    runPhase: t.varchar({ length: 20 }).notNull().default("execute"),
    // runPhase values: "shape" | "plan" | "execute" | "review" | "ship"
    planningProvider: t.varchar({ length: 20 }).notNull().default("internal"),
    syncFailures: t
        .jsonb()
        .$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_7 || (templateObject_7 = __makeTemplateObject(["now()"], ["now()"]))); }),
    completedAt: t.timestamp({ mode: "string", withTimezone: true }),
}); });
exports.CreateTaskRunSchema = (0, drizzle_zod_1.createInsertSchema)(exports.taskRuns, {
    planningWorkspaceId: v4_1.z.string(),
    planningItemId: v4_1.z.string(),
    planningItemIdentifier: v4_1.z.string(),
    workItemIdentifierSnapshot: v4_1.z.string().optional(),
    status: v4_1.z.enum(exports.taskRunStatusEnum),
    blockedReason: v4_1.z.string().optional(),
    branch: v4_1.z.string().optional(),
    planningProvider: v4_1.z.string().max(20).default("internal"),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
});
// =============================================================================
// Comments
// =============================================================================
exports.comments = (0, pg_core_1.pgTable)("comments", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    parentId: t.uuid(),
    body: t.text().notNull(),
    bodyHtml: t.text(),
    edited: t.boolean().notNull().default(false),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_8 || (templateObject_8 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); });
exports.CreateCommentSchema = (0, drizzle_zod_1.createInsertSchema)(exports.comments, {
    body: v4_1.z.string().min(1).max(10000),
    bodyHtml: v4_1.z.string().optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// =============================================================================
// Work Item Artifacts
// =============================================================================
exports.workItemArtifacts = (0, pg_core_1.pgTable)("work_item_artifacts", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    taskRunId: t.uuid().references(function () { return exports.taskRuns.id; }, { onDelete: "set null" }),
    producerType: (0, exports.workItemArtifactProducerTypeEnum)().notNull(),
    producerId: t.text(),
    artifactType: (0, exports.workItemArtifactTypeEnum)().notNull(),
    artifactRole: t.text().notNull(),
    url: t.text(),
    title: t.text(),
    summary: t.text(),
    content: t.text(),
    // sessionId FK to chatConversations.id dropped; re-enable in Task 14 (chat).
    sessionId: t.uuid(),
    metadata: t.json().$type(),
    isCurrent: t.boolean().notNull().default(true),
    contentVersion: t.integer().notNull().default(1),
    lastEditedByUserId: t
        .text()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "set null" }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }),
}); });
exports.CreateWorkItemArtifactSchema = (0, drizzle_zod_1.createInsertSchema)(exports.workItemArtifacts, {
    producerType: v4_1.z.enum(["bob", "forgegraph", "human", "system"]),
    artifactType: v4_1.z.enum(exports.workItemArtifactType),
    artifactRole: v4_1.z.string().min(1),
    url: v4_1.z.string().url().optional(),
    title: v4_1.z.string().optional(),
    summary: v4_1.z.string().optional(),
    content: v4_1.z.string().optional(),
}).omit({
    id: true,
    createdAt: true,
});
// =============================================================================
// Work-item time-travel snapshots
// =============================================================================
exports.workItemSnapshots = (0, pg_core_1.pgTable)("work_item_snapshots", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return exports.workItems.id; }, { onDelete: "cascade" }),
    stage: t.text().notNull(),
    data: t.jsonb().notNull().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("work_item_snapshots_work_item_id_idx").on(table.workItemId),
]; });
// =============================================================================
// Relations
// =============================================================================
exports.workItemsRelations = (0, drizzle_orm_1.relations)(exports.workItems, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        ownerUser: one(auth_js_1.user, {
            fields: [exports.workItems.ownerUserId],
            references: [auth_js_1.user.id],
        }),
        assigneeUser: one(auth_js_1.user, {
            fields: [exports.workItems.assigneeUserId],
            references: [auth_js_1.user.id],
        }),
        workspace: one(tenancy_js_1.workspaces, {
            fields: [exports.workItems.workspaceId],
            references: [tenancy_js_1.workspaces.id],
        }),
        project: one(projects_js_1.projects, {
            fields: [exports.workItems.projectId],
            references: [projects_js_1.projects.id],
        }),
        parent: one(exports.workItems, {
            fields: [exports.workItems.parentId],
            references: [exports.workItems.id],
            relationName: "work_item_parent",
        }),
        children: many(exports.workItems, {
            relationName: "work_item_parent",
        }),
        requirements: many(exports.requirements, {
            relationName: "work_item_requirements",
        }),
        dependencies: many(exports.workItemDependencies, {
            relationName: "work_item_dependencies",
        }),
        dependedOnBy: many(exports.workItemDependencies, {
            relationName: "work_item_depended_on_by",
        }),
    });
});
exports.planDraftsRelations = (0, drizzle_orm_1.relations)(exports.planDrafts, function (_a) {
    var many = _a.many;
    return ({
        // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
        // session: one(chatConversations, {
        //   fields: [planDrafts.sessionId],
        //   references: [chatConversations.id],
        // }),
        dependencies: many(exports.planDraftDependencies, { relationName: "draft" }),
        dependedOnBy: many(exports.planDraftDependencies, { relationName: "dependsOn" }),
    });
});
exports.planDraftDependenciesRelations = (0, drizzle_orm_1.relations)(exports.planDraftDependencies, function (_a) {
    var one = _a.one;
    return ({
        draft: one(exports.planDrafts, {
            fields: [exports.planDraftDependencies.draftId],
            references: [exports.planDrafts.id],
            relationName: "draft",
        }),
        dependsOn: one(exports.planDrafts, {
            fields: [exports.planDraftDependencies.dependsOnDraftId],
            references: [exports.planDrafts.id],
            relationName: "dependsOn",
        }),
    });
});
exports.workItemDependenciesRelations = (0, drizzle_orm_1.relations)(exports.workItemDependencies, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(exports.workItems, {
            fields: [exports.workItemDependencies.workItemId],
            references: [exports.workItems.id],
            relationName: "work_item_dependencies",
        }),
        dependsOn: one(exports.workItems, {
            fields: [exports.workItemDependencies.dependsOnWorkItemId],
            references: [exports.workItems.id],
            relationName: "work_item_depended_on_by",
        }),
    });
});
exports.dispatchBatchesRelations = (0, drizzle_orm_1.relations)(exports.dispatchBatches, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.dispatchBatches.userId],
            references: [auth_js_1.user.id],
        }),
        // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
        // session: one(chatConversations, {
        //   fields: [dispatchBatches.sessionId],
        //   references: [chatConversations.id],
        // }),
        items: many(exports.dispatchItems),
    });
});
exports.dispatchItemsRelations = (0, drizzle_orm_1.relations)(exports.dispatchItems, function (_a) {
    var one = _a.one;
    return ({
        batch: one(exports.dispatchBatches, {
            fields: [exports.dispatchItems.batchId],
            references: [exports.dispatchBatches.id],
        }),
        taskRun: one(exports.taskRuns, {
            fields: [exports.dispatchItems.taskRunId],
            references: [exports.taskRuns.id],
        }),
    });
});
exports.requirementsRelations = (0, drizzle_orm_1.relations)(exports.requirements, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(exports.workItems, {
            fields: [exports.requirements.workItemId],
            references: [exports.workItems.id],
            relationName: "work_item_requirements",
        }),
        linkedTask: one(exports.workItems, {
            fields: [exports.requirements.linkedTaskId],
            references: [exports.workItems.id],
            relationName: "requirement_linked_task",
        }),
    });
});
exports.planTaskItemsRelations = (0, drizzle_orm_1.relations)(exports.planTaskItems, function (_a) {
    var one = _a.one;
    return ({
        plan: one(projects_js_1.worktreePlans, {
            fields: [exports.planTaskItems.planId],
            references: [projects_js_1.worktreePlans.id],
        }),
    });
});
exports.taskRunsRelations = (0, drizzle_orm_1.relations)(exports.taskRuns, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.taskRuns.userId],
            references: [auth_js_1.user.id],
        }),
        // TODO Phase 7B-2 Task 14: re-enable session → chatConversations when chat moves.
        // session: one(chatConversations, {
        //   fields: [taskRuns.sessionId],
        //   references: [chatConversations.id],
        // }),
        workItem: one(exports.workItems, {
            fields: [exports.taskRuns.workItemId],
            references: [exports.workItems.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.taskRuns.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        worktree: one(projects_js_1.worktrees, {
            fields: [exports.taskRuns.worktreeId],
            references: [projects_js_1.worktrees.id],
        }),
        pullRequest: one(git_js_1.pullRequests, {
            fields: [exports.taskRuns.pullRequestId],
            references: [git_js_1.pullRequests.id],
        }),
        parentRun: one(exports.taskRuns, {
            fields: [exports.taskRuns.parentTaskRunId],
            references: [exports.taskRuns.id],
            relationName: "task_run_parent",
        }),
        childRuns: many(exports.taskRuns, {
            relationName: "task_run_parent",
        }),
    });
});
exports.commentsRelations = (0, drizzle_orm_1.relations)(exports.comments, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(exports.workItems, {
            fields: [exports.comments.workItemId],
            references: [exports.workItems.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.comments.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.workItemArtifactsRelations = (0, drizzle_orm_1.relations)(exports.workItemArtifacts, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(exports.workItems, {
            fields: [exports.workItemArtifacts.workItemId],
            references: [exports.workItems.id],
        }),
        taskRun: one(exports.taskRuns, {
            fields: [exports.workItemArtifacts.taskRunId],
            references: [exports.taskRuns.id],
        }),
    });
});
exports.workItemSnapshotsRelations = (0, drizzle_orm_1.relations)(exports.workItemSnapshots, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(exports.workItems, {
            fields: [exports.workItemSnapshots.workItemId],
            references: [exports.workItems.id],
        }),
    });
});
var templateObject_1, templateObject_2, templateObject_3, templateObject_4, templateObject_5, templateObject_6, templateObject_7, templateObject_8;
