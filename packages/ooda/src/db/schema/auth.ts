import { pgTable, index } from "drizzle-orm/pg-core";

/**
 * Local readonly drizzle schema for better-auth `users` and `sessions` tables.
 *
 * These tables are owned by better-auth (via @gmacko/db). We define them here
 * as read-only references so validateSessionToken can query them with drizzle
 * without importing @gmacko/db (which has a drizzle version mismatch).
 *
 * The drizzle client uses `casing: "snake_case"`, so camelCase property names
 * map to snake_case column names automatically (e.g., emailVerified → email_verified).
 */

export const users = pgTable("users", (t) => ({
  id: t.text().primaryKey(),
  name: t.text().notNull(),
  email: t.text().notNull().unique(),
  emailVerified: t.boolean().notNull().default(false),
  image: t.text(),
  createdAt: t
    .timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: t
    .timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}));

export const sessions = pgTable(
  "sessions",
  (t) => ({
    id: t.text().primaryKey(),
    userId: t
      .text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: t.text().notNull().unique(),
    expiresAt: t
      .timestamp({ withTimezone: true, mode: "date" })
      .notNull(),
    ipAddress: t.text(),
    userAgent: t.text(),
    createdAt: t
      .timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  }),
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);
