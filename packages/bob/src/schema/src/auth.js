"use strict";
// =============================================================================
// @bob/auth/schema — Auth tables.
//
// The 4 better-auth tables (user, session, account, verification) are now
// aliased re-exports from gmacko's canonical auth schema. The singular names
// are preserved so the 11+ area packages that do
//   `import { user } from "./auth.js"`
// keep working unchanged.
//
// NOTE: Only the singular aliases are exported here. The canonical plural
// names (users, sessions, accounts, verifications) are re-exported from
// `@bob/db/schema` directly to avoid drizzle-kit seeing the same pgTable
// object under two names and treating it as a schema conflict.
//
// apiKeys + deviceCodes are Bob-owned auth-adjacent tables that reference
// `user` (the alias) via FK.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceHeartbeats = exports.deviceCodes = exports.apiKeys = exports.verification = exports.account = exports.session = exports.user = void 0;
var pg_core_1 = require("drizzle-orm/pg-core");
// --- Better-auth tables (aliased from gmacko) --------------------------------
var auth_1 = require("@gmacko/core/db/schema/auth");
Object.defineProperty(exports, "user", { enumerable: true, get: function () { return auth_1.users; } });
Object.defineProperty(exports, "session", { enumerable: true, get: function () { return auth_1.sessions; } });
Object.defineProperty(exports, "account", { enumerable: true, get: function () { return auth_1.accounts; } });
Object.defineProperty(exports, "verification", { enumerable: true, get: function () { return auth_1.verifications; } });
// --- Bob-owned auth-adjacent tables ------------------------------------------
// Import the gmacko `users` table for FK references.
var auth_2 = require("@gmacko/core/db/schema/auth");
exports.apiKeys = (0, pg_core_1.pgTable)("api_keys", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_2.users.id; }, { onDelete: "cascade" }),
    name: t.varchar({ length: 100 }).notNull(),
    keyHash: t.text().notNull(),
    keyPrefix: t.varchar({ length: 12 }).notNull(),
    permissions: t.json().$type().notNull().default(["read"]),
    lastUsedAt: t.timestamp({ mode: "string", withTimezone: true }),
    expiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    revokedAt: t.timestamp({ mode: "string", withTimezone: true }),
}); });
exports.deviceCodes = (0, pg_core_1.pgTable)("device_codes", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    deviceCode: t.uuid("device_code").notNull().unique().defaultRandom(),
    userCode: t.varchar("user_code", { length: 16 }).notNull().unique(),
    deviceName: t.varchar("device_name", { length: 100 }),
    apiKey: t.text("api_key"),
    userId: t
        .text("user_id")
        .references(function () { return auth_2.users.id; }, { onDelete: "cascade" }),
    status: t.varchar({ length: 16 }).notNull().default("pending"),
    expiresAt: t.timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); });
exports.deviceHeartbeats = (0, pg_core_1.pgTable)("device_heartbeats", function (t) { return ({
    apiKeyId: t
        .uuid("api_key_id")
        .notNull()
        .primaryKey()
        .references(function () { return exports.apiKeys.id; }, { onDelete: "cascade" }),
    userId: t
        .text("user_id")
        .notNull()
        .references(function () { return auth_2.users.id; }, { onDelete: "cascade" }),
    deviceName: t.varchar("device_name", { length: 100 }).notNull(),
    state: t.varchar({ length: 64 }).notNull(),
    message: t.text(),
    wifi: t.text(),
    batteryPercent: t.integer("battery_percent"),
    details: t.json().$type().notNull().default({}),
    lastSeenAt: t
        .timestamp("last_seen_at", { mode: "string", withTimezone: true })
        .notNull(),
    createdAt: t
        .timestamp("created_at", { mode: "string", withTimezone: true })
        .defaultNow()
        .notNull(),
}); });
