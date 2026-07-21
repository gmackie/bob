// =============================================================================
// @bob/notifications/schema — Notifications-area tables, enums, relations,
// and insert/zod schemas.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 18):
//   - eventLog
//   - activities
//   - notifications
//   - devicePushTokens
//
// Enums:
//   - eventTypeEnum / EventType
//
// Relations:
//   - eventLogRelations
//   - activitiesRelations
//   - notificationsRelations
//   - devicePushTokensRelations
//
// Cross-area imports:
//   - user                                  from @bob/auth/schema
//   - repositories, worktrees               from @bob/projects/schema
//   - workItems, workItemActivityTypeEnum,
//     workItemNotificationType,
//     workItemNotificationTypeEnum           from @bob/work-items/schema
// =============================================================================

import { relations } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { user } from "@bob/auth/schema";
import { repositories, worktrees } from "@bob/projects/schema";
import {
  workItemActivityTypeEnum,
  workItemNotificationType,
  workItemNotificationTypeEnum,
  workItems,
} from "@bob/work-items/schema";

export const eventTypeEnum = [
  "instance.started",
  "instance.stopped",
  "instance.error",
  "git.commit",
  "git.push",
  "git.pull",
  "git.checkout",
  "file.created",
  "file.modified",
  "file.deleted",
  "plan.created",
  "plan.updated",
  "plan.task_completed",
  "chat.message",
  "chat.tool_call",
  "chat.tool_result",
  "worktree.created",
  "worktree.deleted",
  "link.created",
  "link.removed",
] as const;
export type EventType = (typeof eventTypeEnum)[number];

export const eventLog = pgTable("event_log", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  worktreeId: t.uuid().references(() => worktrees.id, { onDelete: "set null" }),
  repositoryId: t
    .uuid()
    .references(() => repositories.id, { onDelete: "set null" }),
  eventType: t.varchar({ length: 50 }).notNull(),
  payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const activities = pgTable("activities", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  workItemId: t
    .uuid()
    .notNull()
    .references(() => workItems.id, { onDelete: "cascade" }),
  userId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemActivityTypeEnum().notNull(),
  fromValue: t.text(),
  toValue: t.text(),
  metadata: t.json().$type<Record<string, unknown>>(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const notifications = pgTable("notifications", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  workItemId: t
    .uuid()
    .references(() => workItems.id, { onDelete: "cascade" }),
  actorId: t.text().references(() => user.id, { onDelete: "set null" }),
  type: workItemNotificationTypeEnum().notNull(),
  title: t.text().notNull(),
  body: t.text(),
  url: t.text(),
  read: t.boolean().notNull().default(false),
  readAt: t.timestamp({ mode: "string", withTimezone: true }),
  archivedAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateNotificationSchema = createInsertSchema(notifications, {
  type: z.enum(workItemNotificationType),
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  url: z.string().url().optional(),
}).omit({
  id: true,
  read: true,
  readAt: true,
  archivedAt: true,
  createdAt: true,
});

// --- Notification Outbox ---
// Protocol state, not inbox state (the `notifications` table above is the
// user-facing inbox). One row per run-state transition occurrence; identity
// derives from the source transition's runner send-seq, never a locally
// counted occurrence (replay/concurrency can double-count a counter; a durable
// event id cannot). The unique index is the exactly-once *send intent* guard.
// Delivery over APNs/FCM is at-least-once; a crash between Expo-accept and
// outcome-commit is unknowable — the row is retried and a rare duplicate push
// is tolerated by design.

export const outboxStatusEnum = [
  "pending",
  "claimed",
  "sent",
  "failed",
] as const;
export type OutboxStatus = (typeof outboxStatusEnum)[number];

export const notificationOutbox = pgTable(
  "notification_outbox",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t.uuid().notNull(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Derived run state this row announces: blocked | failed | interrupted |
    // completed | host_unknown (varchar to avoid coupling to the pgEnum).
    transition: t.varchar({ length: 30 }).notNull(),
    // Runner send-seq of the event that caused the transition. -1 for
    // gateway-originated transitions (lease expiry): the gateway writes a
    // given transition at most once per lease cycle, so the unique key still
    // dedups those.
    sourceSendSeq: t.bigint("source_send_seq", { mode: "number" }).notNull(),
    status: t.varchar({ length: 12 }).notNull().default("pending"),
    attempts: t.integer().notNull().default(0),
    claimedAt: t.timestamp({ mode: "string", withTimezone: true }),
    sentAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastError: t.text(),
    // Stable message id reused across retries so client-side dedup and Expo
    // receipt lookups survive the ambiguous-send window.
    messageId: t.uuid().notNull().defaultRandom(),
    // Push payload contract: {sessionId, workItemId?, hostId?, transition,
    // sourceSendSeq} plus title/body copy.
    payload: t.json().$type<Record<string, unknown>>().notNull().default({}),
    // Expo ticket ids by device token, written when the send is accepted;
    // the receipts cron resolves them ~15 min later and prunes dead tokens.
    expoTickets: t.json().$type<Record<string, string>>(),
    receiptsResolvedAt: t.timestamp({ mode: "string", withTimezone: true }),
    // Pull backstop: the mobile badge counts rows with seenAt IS NULL — a
    // push dropped by APNs/FCM is still visible on next app open.
    seenAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    {
      name: "notification_outbox_occurrence_unique",
      columns: [table.sessionId, table.transition, table.sourceSendSeq],
      unique: true,
    },
    index("notification_outbox_status_idx").on(table.status),
    index("notification_outbox_user_idx").on(table.userId),
  ],
);

// 6.1a Device Push Tokens (for mobile notifications)
export const devicePushTokens = pgTable("device_push_tokens", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceType: t.varchar({ length: 20 }).notNull(), // 'ios' | 'android' | 'web'
  expoPushToken: t.text().notNull(),
  deviceName: t.text(),
  enabled: t.boolean().notNull().default(true),
  lastSeenAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const CreateDevicePushTokenSchema = createInsertSchema(
  devicePushTokens,
  {
    deviceType: z.enum(["ios", "android", "web"]),
    expoPushToken: z.string(),
    deviceName: z.string().optional(),
    enabled: z.boolean().default(true),
  },
).omit({
  id: true,
  userId: true,
  createdAt: true,
  lastSeenAt: true,
});

// ── Relations ────────────────────────────────────────────────────────

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  user: one(user, {
    fields: [eventLog.userId],
    references: [user.id],
  }),
  worktree: one(worktrees, {
    fields: [eventLog.worktreeId],
    references: [worktrees.id],
  }),
  repository: one(repositories, {
    fields: [eventLog.repositoryId],
    references: [repositories.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  workItem: one(workItems, {
    fields: [activities.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [activities.userId],
    references: [user.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
  workItem: one(workItems, {
    fields: [notifications.workItemId],
    references: [workItems.id],
  }),
  actor: one(user, {
    fields: [notifications.actorId],
    references: [user.id],
  }),
}));

export const devicePushTokensRelations = relations(
  devicePushTokens,
  ({ one }) => ({
    user: one(user, {
      fields: [devicePushTokens.userId],
      references: [user.id],
    }),
  }),
);
