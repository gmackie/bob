// NOTE: OODA-adjacent. This table is part of the current gmacko skeleton's
// exploration/chat UI and will move to @ooda/thread-model during OODA migration
// (Phase 8). It is NOT the agent session primitive — that lives in
// chat_conversations + chat_messages (packages/db/src/schema/sessions.ts),
// landed in Phase 6B.
import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";
import { thread } from "./threads";

export const branch = pgTable("branch", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => thread.id, { onDelete: "cascade" }),
  parentBranchId: uuid("parent_branch_id"),
  forkPointMessageId: uuid("fork_point_message_id"),
  name: varchar("name", { length: 256 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
