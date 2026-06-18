import { sql } from "drizzle-orm";
import { pgTable, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const threadStatusEnum = pgEnum("thread_status", [
  "active",
  "paused",
  "archived",
  "completed",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const researchThread = pgTable("research_thread", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  title: t.varchar({ length: 256 }).notNull(),
  slug: t.varchar({ length: 128 }).notNull().unique(),
  domainPackId: t.varchar({ length: 64 }),
  ownerId: t.text(),
  status: threadStatusEnum().notNull().default("active"),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreateResearchThreadSchema = createInsertSchema(researchThread, {
  title: z.string().min(1).max(256),
  slug: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const runnerDevice = pgTable("runner_device", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  name: t.varchar({ length: 128 }).notNull(),
  hostname: t.varchar({ length: 256 }),
  status: t.varchar({ length: 32 }).notNull().default("online"),
  lastHeartbeatAt: t.timestamp({ mode: "date", withTimezone: true }),
  capabilities: t.json().$type<string[]>().notNull().default([]),
  registeredAt: t.timestamp().defaultNow().notNull(),
}));

export const runnerSession = pgTable("runner_session", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  threadId: t
    .uuid()
    .notNull()
    .references(() => researchThread.id, { onDelete: "cascade" }),
  runnerId: t
    .uuid()
    .notNull()
    .references(() => runnerDevice.id, { onDelete: "cascade" }),
  adapterId: t.varchar({ length: 64 }).notNull(),
  toolProfileId: t.varchar({ length: 64 }).notNull(),
  status: sessionStatusEnum().notNull().default("pending"),
  startedAt: t.timestamp({ mode: "date", withTimezone: true }),
  completedAt: t.timestamp({ mode: "date", withTimezone: true }),
  exitCode: t.integer(),
  comparisonId: t.uuid(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const provenanceEvent = pgTable("provenance_event", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  artifactId: t.text().notNull(),
  threadId: t
    .uuid()
    .notNull()
    .references(() => researchThread.id, { onDelete: "cascade" }),
  sessionId: t.uuid().references(() => runnerSession.id),
  capabilityId: t.varchar({ length: 64 }).notNull(),
  operationId: t.varchar({ length: 64 }).notNull(),
  sourceType: t.varchar({ length: 32 }).notNull(),
  queryOrInputRef: t.text().notNull(),
  canonicalSourceRef: t.text(),
  unverified: t.boolean().default(false),
  retrievedAt: t.timestamp({ mode: "date", withTimezone: true }).notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));

export const sessionEvent = pgTable("session_event", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  sessionId: t
    .uuid()
    .notNull()
    .references(() => runnerSession.id, { onDelete: "cascade" }),
  type: t.varchar({ length: 32 }).notNull(),
  content: t.text().notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
}));
