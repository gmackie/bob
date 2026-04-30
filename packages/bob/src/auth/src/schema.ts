// =============================================================================
// @bob/auth/schema — Auth tables.
//
// Better-auth tables (user, session, account, verification) are kept in
// their better-auth-generated shape; do not alter columns here without
// coordinating with the better-auth CLI generator. The 7B-3 Auth migration
// will reconcile these with gmacko's auth shape.
//
// apiKeys + deviceCodes are Bob-owned auth-adjacent tables that hang off
// `user` via FK; they live alongside the better-auth tables for cross-area
// locality.
// =============================================================================

import { pgTable } from "drizzle-orm/pg-core";

// --- Better-auth tables -------------------------------------------------------

export const user = pgTable("user", (t) => ({
  id: t.text().primaryKey(),
  name: t.text().notNull(),
  email: t.text().notNull().unique(),
  emailVerified: t.boolean().notNull(),
  image: t.text(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
}));

export const session = pgTable("session", (t) => ({
  id: t.text().primaryKey(),
  expiresAt: t.timestamp().notNull(),
  token: t.text().notNull().unique(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
  ipAddress: t.text(),
  userAgent: t.text(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}));

export const account = pgTable("account", (t) => ({
  id: t.text().primaryKey(),
  accountId: t.text().notNull(),
  providerId: t.text().notNull(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: t.text(),
  refreshToken: t.text(),
  idToken: t.text(),
  accessTokenExpiresAt: t.timestamp(),
  refreshTokenExpiresAt: t.timestamp(),
  scope: t.text(),
  password: t.text(),
  createdAt: t.timestamp().notNull(),
  updatedAt: t.timestamp().notNull(),
}));

export const verification = pgTable("verification", (t) => ({
  id: t.text().primaryKey(),
  identifier: t.text().notNull(),
  value: t.text().notNull(),
  expiresAt: t.timestamp().notNull(),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
}));

// --- Bob-owned auth-adjacent tables ------------------------------------------

export const apiKeys = pgTable("api_keys", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  userId: t
    .text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
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
  apiKey: t.text("api_key"),
  userId: t
    .text("user_id")
    .references(() => user.id, { onDelete: "cascade" }),
  status: t.varchar({ length: 16 }).notNull().default("pending"),
  expiresAt: t.timestamp("expires_at", { mode: "string" }).notNull(),
  createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}));
