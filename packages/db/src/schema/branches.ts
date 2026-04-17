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
