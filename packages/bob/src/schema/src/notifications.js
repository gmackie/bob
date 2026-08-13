"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.devicePushTokensRelations = exports.notificationsRelations = exports.activitiesRelations = exports.eventLogRelations = exports.CreateDevicePushTokenSchema = exports.devicePushTokens = exports.notificationOutbox = exports.outboxStatusEnum = exports.CreateNotificationSchema = exports.notifications = exports.notificationPreferences = exports.activities = exports.eventLog = exports.eventTypeEnum = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var drizzle_zod_1 = require("drizzle-zod");
var v4_1 = require("zod/v4");
var auth_js_1 = require("./auth.js");
var projects_js_1 = require("./projects.js");
var work_items_js_1 = require("./work-items.js");
exports.eventTypeEnum = [
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
];
exports.eventLog = (0, pg_core_1.pgTable)("event_log", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    worktreeId: t.uuid().references(function () { return projects_js_1.worktrees.id; }, { onDelete: "set null" }),
    repositoryId: t
        .uuid()
        .references(function () { return projects_js_1.repositories.id; }, { onDelete: "set null" }),
    eventType: t.varchar({ length: 50 }).notNull(),
    payload: t.json().$type().notNull().default({}),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.activities = (0, pg_core_1.pgTable)("activities", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    workItemId: t
        .uuid()
        .notNull()
        .references(function () { return work_items_js_1.workItems.id; }, { onDelete: "cascade" }),
    userId: t.text().references(function () { return auth_js_1.user.id; }, { onDelete: "set null" }),
    type: (0, work_items_js_1.workItemActivityTypeEnum)().notNull(),
    fromValue: t.text(),
    toValue: t.text(),
    metadata: t.json().$type(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
/**
 * Per-type, per-channel notification overrides.
 *
 * Sparse on purpose: a row exists only where a person has expressed an
 * opinion, and everything else falls back to DEFAULT_NOTIFICATION_PREFERENCES
 * in ./preferences.ts. Writing 18 rows per user at signup would make the
 * defaults impossible to change later without a migration touching everyone.
 */
exports.notificationPreferences = (0, pg_core_1.pgTable)("notification_preferences", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    type: (0, work_items_js_1.workItemNotificationTypeEnum)().notNull(),
    /** "push" | "email" | "in_app" — see NotificationChannel. */
    channel: t.varchar({ length: 16 }).notNull(),
    enabled: t.boolean().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .defaultNow()
        .notNull(),
}); }, function (table) { return [
    (0, pg_core_1.index)("notification_preferences_user_idx").on(table.userId),
    // One opinion per (user, type, channel); upserts key on this.
    (0, pg_core_1.uniqueIndex)("notification_preferences_unique_idx").on(table.userId, table.type, table.channel),
]; });
exports.notifications = (0, pg_core_1.pgTable)("notifications", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    workItemId: t
        .uuid()
        .references(function () { return work_items_js_1.workItems.id; }, { onDelete: "cascade" }),
    actorId: t.text().references(function () { return auth_js_1.user.id; }, { onDelete: "set null" }),
    type: (0, work_items_js_1.workItemNotificationTypeEnum)().notNull(),
    title: t.text().notNull(),
    body: t.text(),
    url: t.text(),
    read: t.boolean().notNull().default(false),
    readAt: t.timestamp({ mode: "string", withTimezone: true }),
    archivedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.CreateNotificationSchema = (0, drizzle_zod_1.createInsertSchema)(exports.notifications, {
    type: v4_1.z.enum(work_items_js_1.workItemNotificationType),
    title: v4_1.z.string().min(1).max(256),
    body: v4_1.z.string().optional(),
    url: v4_1.z.string().url().optional(),
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
exports.outboxStatusEnum = [
    "pending",
    "claimed",
    "sent",
    "failed",
];
exports.notificationOutbox = (0, pg_core_1.pgTable)("notification_outbox", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t.uuid().notNull(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
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
    payload: t.json().$type().notNull().default({}),
    // Expo ticket ids by device token, written when the send is accepted;
    // the receipts cron resolves them ~15 min later and prunes dead tokens.
    expoTickets: t.json().$type(),
    receiptsResolvedAt: t.timestamp({ mode: "string", withTimezone: true }),
    // Pull backstop: the mobile badge counts rows with seenAt IS NULL — a
    // push dropped by APNs/FCM is still visible on next app open.
    seenAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    {
        name: "notification_outbox_occurrence_unique",
        columns: [table.sessionId, table.transition, table.sourceSendSeq],
        unique: true,
    },
    (0, pg_core_1.index)("notification_outbox_status_idx").on(table.status),
    (0, pg_core_1.index)("notification_outbox_user_idx").on(table.userId),
]; });
// 6.1a Device Push Tokens (for mobile notifications)
exports.devicePushTokens = (0, pg_core_1.pgTable)("device_push_tokens", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    deviceType: t.varchar({ length: 20 }).notNull(), // 'ios' | 'android' | 'web'
    expoPushToken: t.text().notNull(),
    deviceName: t.text(),
    enabled: t.boolean().notNull().default(true),
    lastSeenAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.CreateDevicePushTokenSchema = (0, drizzle_zod_1.createInsertSchema)(exports.devicePushTokens, {
    deviceType: v4_1.z.enum(["ios", "android", "web"]),
    expoPushToken: v4_1.z.string(),
    deviceName: v4_1.z.string().optional(),
    enabled: v4_1.z.boolean().default(true),
}).omit({
    id: true,
    userId: true,
    createdAt: true,
    lastSeenAt: true,
});
// ── Relations ────────────────────────────────────────────────────────
exports.eventLogRelations = (0, drizzle_orm_1.relations)(exports.eventLog, function (_a) {
    var one = _a.one;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.eventLog.userId],
            references: [auth_js_1.user.id],
        }),
        worktree: one(projects_js_1.worktrees, {
            fields: [exports.eventLog.worktreeId],
            references: [projects_js_1.worktrees.id],
        }),
        repository: one(projects_js_1.repositories, {
            fields: [exports.eventLog.repositoryId],
            references: [projects_js_1.repositories.id],
        }),
    });
});
exports.activitiesRelations = (0, drizzle_orm_1.relations)(exports.activities, function (_a) {
    var one = _a.one;
    return ({
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.activities.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        user: one(auth_js_1.user, {
            fields: [exports.activities.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.notificationsRelations = (0, drizzle_orm_1.relations)(exports.notifications, function (_a) {
    var one = _a.one;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.notifications.userId],
            references: [auth_js_1.user.id],
        }),
        workItem: one(work_items_js_1.workItems, {
            fields: [exports.notifications.workItemId],
            references: [work_items_js_1.workItems.id],
        }),
        actor: one(auth_js_1.user, {
            fields: [exports.notifications.actorId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.devicePushTokensRelations = (0, drizzle_orm_1.relations)(exports.devicePushTokens, function (_a) {
    var one = _a.one;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.devicePushTokens.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
