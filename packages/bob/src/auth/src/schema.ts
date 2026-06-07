// =============================================================================
// @bob/auth/schema — Auth tables.
//
// The 4 better-auth tables (user, session, account, verification) are now
// aliased re-exports from gmacko's canonical auth schema. The singular names
// are preserved so the 11+ area packages that do
//   `import { user } from "@bob/auth/schema"`
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

import { pgTable } from "drizzle-orm/pg-core";

// --- Better-auth tables (aliased from gmacko) --------------------------------

export {
  users as user,
  sessions as session,
  accounts as account,
  verifications as verification,
} from "@gmacko/core/db/schema/auth";

// --- Bob-owned auth-adjacent tables ------------------------------------------

// Import the gmacko `users` table for FK references.
import { users } from "@gmacko/core/db/schema/auth";

export const apiKeys = pgTable("api_keys", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: t.varchar({ length: 100 }).notNull(),
  keyHash: t.text().notNull(),
  keyPrefix: t.varchar({ length: 12 }).notNull(),
  permissions: t.json().$type<string[]>().notNull().default(["read"]),
  lastUsedAt: t.timestamp({ mode: "string", withTimezone: true }),
  expiresAt: t.timestamp({ mode: "string", withTimezone: true }),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  revokedAt: t.timestamp({ mode: "string", withTimezone: true }),
}));

export const deviceCodes = pgTable("device_codes", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  deviceCode: t.uuid("device_code").notNull().unique().defaultRandom(),
  userCode: t.varchar("user_code", { length: 16 }).notNull().unique(),
  deviceName: t.varchar("device_name", { length: 100 }),
  apiKey: t.text("api_key"),
  userId: t
    .text("user_id")
    .references(() => users.id, { onDelete: "cascade" }),
  status: t.varchar({ length: 16 }).notNull().default("pending"),
  expiresAt: t.timestamp("expires_at", { mode: "string" }).notNull(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));

export const deviceHeartbeats = pgTable("device_heartbeats", (t) => ({
  apiKeyId: t
    .uuid("api_key_id")
    .notNull()
    .primaryKey()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  userId: t
    .text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceName: t.varchar("device_name", { length: 100 }).notNull(),
  state: t.varchar({ length: 64 }).notNull(),
  message: t.text(),
  wifi: t.text(),
  batteryPercent: t.integer("battery_percent"),
  details: t.json().$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: t
    .timestamp("last_seen_at", { mode: "string", withTimezone: true })
    .notNull(),
  createdAt: t
    .timestamp("created_at", { mode: "string", withTimezone: true })
    .defaultNow()
    .notNull(),
}));
