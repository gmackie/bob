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

import { relations } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "@bob/auth/schema";
import { repositories, worktrees } from "@bob/projects/schema";
import {
  agentInstances,
  sessionConnections,
  sessionEvents,
} from "@bob/agents/schema";
import { planDrafts, workItems } from "@bob/work-items/schema";

// --- Chat Conversations ---

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
    lastActivityAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastError: t
      .json()
      .$type<{ code: string; message: string; timestamp: string }>(),
    claimedByGatewayId: t.text(),
    leaseExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
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
    awaitingInputExpiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    awaitingInputResolvedAt: t.timestamp({ mode: "string", withTimezone: true }),
    awaitingInputResolution: t
      .json()
      .$type<{ type: "human" | "timeout"; value: string }>(),
    personaId: t.uuid(),
    personaMetadata: t.json().$type<Record<string, unknown>>(),
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
    dispatchSpec: t.json("dispatch_spec").$type<{
      prompt: string;
      repositoryId?: string;
      worktreeConfig?: Record<string, unknown>;
      personaId?: string;
      model?: string;
      allowedTools?: string[];
    }>(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }),
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

// --- Chat Messages ---

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
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

// --- Chat Attachments ---

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
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}), (table) => [
  index("chat_attachments_message_id_idx").on(table.messageId),
]);

// --- Planning session collab chat (human ↔ human, BOB-14) ---

export const planningSessionMessages = pgTable(
  "planning_session_messages",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientMessageId: t.text(),
    body: t.text().notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("planning_session_messages_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

// =============================================================================
// Relations
// =============================================================================

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
    planningCollabMessages: many(planningSessionMessages),
    events: many(sessionEvents),
    connections: many(sessionConnections),
    planDrafts: many(planDrafts),
  }),
);

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

export const planningSessionMessagesRelations = relations(
  planningSessionMessages,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [planningSessionMessages.sessionId],
      references: [chatConversations.id],
    }),
    user: one(user, {
      fields: [planningSessionMessages.userId],
      references: [user.id],
    }),
  }),
);
