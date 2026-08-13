"use strict";
// =============================================================================
// @bob/chat/schema — Chat conversations, messages, and attachments.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 14):
//   - chatConversations
//   - chatMessages
//   - chatAttachments
// BOB-14:
//   - planningSessionMessages (human collab chat on planning sessions)
//
// Relations:
//   - chatConversationsRelations
//   - chatMessagesRelations
//   - chatAttachmentsRelations
//   - planningSessionMessagesRelations
//
// Cross-area imports:
//   - user from @bob/auth/schema
//   - repositories, worktrees from @bob/projects/schema
//   - agentInstances, sessionEvents, sessionConnections from @bob/agents/schema
//   - workItems, planDrafts from @bob/work-items/schema
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.planningSessionMessagesRelations = exports.chatAttachmentsRelations = exports.chatMessagesRelations = exports.chatConversationsRelations = exports.planningSessionMessages = exports.chatAttachments = exports.chatMessages = exports.chatConversations = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var auth_js_1 = require("./auth.js");
var projects_js_1 = require("./projects.js");
var agents_js_1 = require("./agents.js");
var work_items_js_1 = require("./work-items.js");
// --- Chat Conversations ---
exports.chatConversations = (0, pg_core_1.pgTable)("chat_conversations", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    repositoryId: t
        .uuid()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "set null" }),
    worktreeId: t
        .uuid()
        .references(function () { return projects_js_1.worktrees.id; }, { onDelete: "set null" }),
    agentInstanceId: t
        .uuid()
        .references(function () { return agents_js_1.agentInstances.id; }, { onDelete: "set null" }),
    title: t.varchar({ length: 256 }),
    workingDirectory: t.text(),
    agentType: t.varchar({ length: 50 }).notNull().default("opencode"),
    sessionType: t.varchar({ length: 20 }).notNull().default("execution"),
    opencodeSessionId: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("stopped"),
    nextSeq: t.bigint({ mode: "number" }).notNull().default(1),
    lastActivityAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastError: t
        .json()
        .$type(),
    claimedByGatewayId: t.text(),
    leaseExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    gitBranch: t.text(),
    pullRequestId: t.uuid(),
    planningTaskId: t.text("kanbanger_task_id"),
    workItemId: t.uuid().references(function () { return work_items_js_1.workItems.id; }, { onDelete: "set null" }),
    workItemIdentifierSnapshot: t.text(),
    blockedReason: t.text(),
    workflowStatus: t.varchar({ length: 30 }).notNull().default("started"),
    statusMessage: t.text(),
    awaitingInputQuestion: t.text(),
    awaitingInputOptions: t.json().$type(),
    awaitingInputDefault: t.text(),
    awaitingInputExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    awaitingInputResolvedAt: t.timestamp({ mode: "string", withTimezone: true }),
    awaitingInputResolution: t
        .json()
        .$type(),
    personaId: t.uuid(),
    personaMetadata: t.json().$type(),
    planningSessionType: t.varchar({ length: 30 }),
    // values: "office_hours" | "ceo_review" | "eng_review" | "design_review" | "breakdown"
    // Planning session execution context — populated by planSession.start,
    // consumed by ws-gateway + daemon when sessionType = "planning".
    planningWorkspaceId: t.uuid("planning_workspace_id"),
    planningProjectId: t.uuid("planning_project_id"),
    planningProjectName: t.text("planning_project_name"),
    planningLaunchContext: t.json("planning_launch_context"),
    retryCount: t.integer().notNull().default(0),
    interruptedAt: t.timestamp({ mode: "string", withTimezone: true }),
    // Immutable dispatch specification captured at dispatch time — the exact
    // prompt, repo/worktree config, persona, model, and tool allowlist.
    // Retry re-dispatches from this verbatim; titles and reconstructed
    // prompts are not equivalent. Never updated after insert.
    dispatchSpec: t.json("dispatch_spec").$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }),
}); }, function (table) { return [
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
]; });
// --- Chat Messages ---
exports.chatMessages = (0, pg_core_1.pgTable)("chat_messages", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    conversationId: t
        .uuid()
        .notNull()
        .references(function () { return exports.chatConversations.id; }, { onDelete: "cascade" }),
    role: t.varchar({ length: 20 }).notNull(),
    content: t.text().notNull(),
    toolCalls: t
        .json()
        .$type(),
    toolCallId: t.varchar({ length: 100 }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
// --- Chat Attachments ---
exports.chatAttachments = (0, pg_core_1.pgTable)("chat_attachments", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    messageId: t
        .uuid()
        .references(function () { return exports.chatMessages.id; }, { onDelete: "cascade" }),
    type: t.text({ enum: ["image", "file"] }).notNull().default("image"),
    url: t.text().notNull(),
    filename: t.text(),
    mimeType: t.text(),
    width: t.integer(),
    height: t.integer(),
    sizeBytes: t.integer(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("chat_attachments_message_id_idx").on(table.messageId),
]; });
// --- Planning session collab chat (human ↔ human, BOB-14) ---
exports.planningSessionMessages = (0, pg_core_1.pgTable)("planning_session_messages", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return exports.chatConversations.id; }, { onDelete: "cascade" }),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    clientMessageId: t.text(),
    body: t.text().notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("planning_session_messages_session_created_idx").on(table.sessionId, table.createdAt),
]; });
// =============================================================================
// Relations
// =============================================================================
exports.chatConversationsRelations = (0, drizzle_orm_1.relations)(exports.chatConversations, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.chatConversations.userId],
            references: [auth_js_1.user.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.chatConversations.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
        worktree: one(projects_js_1.worktrees, {
            fields: [exports.chatConversations.worktreeId],
            references: [projects_js_1.worktrees.id],
        }),
        agentInstance: one(agents_js_1.agentInstances, {
            fields: [exports.chatConversations.agentInstanceId],
            references: [agents_js_1.agentInstances.id],
        }),
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.chatConversations.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        messages: many(exports.chatMessages),
        planningCollabMessages: many(exports.planningSessionMessages),
        events: many(agents_js_1.sessionEvents),
        connections: many(agents_js_1.sessionConnections),
        planDrafts: many(work_items_js_1.planDrafts),
    });
});
exports.chatMessagesRelations = (0, drizzle_orm_1.relations)(exports.chatMessages, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        conversation: one(exports.chatConversations, {
            fields: [exports.chatMessages.conversationId],
            references: [exports.chatConversations.id],
        }),
        attachments: many(exports.chatAttachments),
    });
});
exports.chatAttachmentsRelations = (0, drizzle_orm_1.relations)(exports.chatAttachments, function (_a) {
    var one = _a.one;
    return ({
        message: one(exports.chatMessages, {
            fields: [exports.chatAttachments.messageId],
            references: [exports.chatMessages.id],
        }),
    });
});
exports.planningSessionMessagesRelations = (0, drizzle_orm_1.relations)(exports.planningSessionMessages, function (_a) {
    var one = _a.one;
    return ({
        session: one(exports.chatConversations, {
            fields: [exports.planningSessionMessages.sessionId],
            references: [exports.chatConversations.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.planningSessionMessages.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
