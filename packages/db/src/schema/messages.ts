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
