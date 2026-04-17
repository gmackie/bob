import { pgTable, pgEnum, uuid, varchar, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const threadStatusEnum = pgEnum("thread_status", [
  "active", "paused", "archived", "completed",
]);

export const thread = pgTable("thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 256 }).notNull(),
  status: threadStatusEnum("status").default("active").notNull(),
  activeBranchId: uuid("active_branch_id"),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const CreateThreadSchema = createInsertSchema(thread, {
  title: z.string().min(1).max(256),
}).omit({ id: true, createdAt: true, updatedAt: true, activeBranchId: true });

export const UpdateThreadStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "paused", "archived", "completed"]),
});
