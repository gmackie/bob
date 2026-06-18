import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tenants } from "./tenancy.js";
import { users } from "./auth.js";

// Agent session primitive. `chat_conversations` is one row per agent
// session; `chat_messages` is the transcript attached to a conversation.
// These are NOT the OODA-adjacent `thread` / `branch` / `message` tables
// in schema/{threads,branches,messages}.ts — those remain untouched and
// will move during the OODA migration (Phase 8).
//
// The `chat_message_role` pgEnum intentionally uses a distinct Postgres
// type name from the legacy `message_role` enum in messages.ts so the
// two schemas never collide on a real Postgres server.

export const sessionStatus = pgEnum("session_status", [
  "pending",
  "active",
  "completed",
  "failed",
  "canceled",
]);

export const chatMessageRole = pgEnum("chat_message_role", [
  "user",
  "assistant",
  "system",
  "tool",
]);

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }),
    adapterId: varchar("adapter_id", { length: 128 }).notNull(),
    status: sessionStatus("status").notNull().default("pending"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("chat_conversations_tenant_id_idx").on(table.tenantId),
    userIdIdx: index("chat_conversations_user_id_idx").on(table.userId),
    statusIdx: index("chat_conversations_status_idx").on(table.status),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: chatMessageRole("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    conversationIdIdx: index("chat_messages_conversation_id_idx").on(
      table.conversationId,
    ),
    uniqueConversationSeq: unique(
      "chat_messages_conversation_seq_unique",
    ).on(table.conversationId, table.seq),
  }),
);

// drizzle-zod schemas for RPC validation
export const chatConversationsInsertSchema =
  createInsertSchema(chatConversations);
export const chatConversationsSelectSchema =
  createSelectSchema(chatConversations);
export const chatMessagesInsertSchema = createInsertSchema(chatMessages);
export const chatMessagesSelectSchema = createSelectSchema(chatMessages);

// Row type exports
export type ChatConversation = typeof chatConversations.$inferSelect;
export type NewChatConversation = typeof chatConversations.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
