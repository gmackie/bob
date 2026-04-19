// NOTE: OODA-adjacent. This table is part of the current gmacko skeleton's
// exploration/chat UI and will move to @ooda/thread-model during OODA migration
// (Phase 8). It is NOT the agent session primitive — that lives in
// chat_conversations + chat_messages (packages/db/src/schema/sessions.ts),
// landed in Phase 6B.
import { pgTable, pgEnum, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { thread } from "./threads";
import { branch } from "./branches";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const message = pgTable("message", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id").notNull().references(() => branch.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
