// =============================================================================
// @bob/cookies/schema — Browser cookie jar and session cookie scopes.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 19):
//   - browserCookies
//   - sessionCookieScopes
//
// Const-array enums:
//   - cookieSourceEnum
//   - sameSiteEnum
//
// Relations:
//   - browserCookiesRelations
//   - sessionCookieScopesRelations
//
// Cross-area imports:
//   - user from @bob/auth/schema
//   - chatConversations from @bob/chat/schema
// =============================================================================

import { relations, sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "@bob/auth/schema";
import { chatConversations } from "@bob/chat/schema";

// ── Const-array enums ─────────────────────────────────────────────

export const cookieSourceEnum = ["extension", "cli"] as const;
export const sameSiteEnum = ["Strict", "Lax", "None"] as const;

// ── Browser Cookie Jar ─────────────────────────────────────────────

export const browserCookies = pgTable(
  "browser_cookies",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    name: t.text().notNull(),
    valueCiphertext: t.text().notNull(),
    valueIv: t.text().notNull(),
    valueTag: t.text().notNull(),
    path: t.text().notNull().default("/"),
    expires: t.timestamp({ mode: "string", withTimezone: true }),
    secure: t.boolean().notNull().default(false),
    httpOnly: t.boolean().notNull().default(false),
    sameSite: t.varchar({ length: 10 }).notNull().default("Lax"),
    source: t.varchar({ length: 20 }).notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("browser_cookies_user_domain_name_path_idx").on(
      table.userId,
      table.domain,
      table.name,
      table.path,
    ),
    index("browser_cookies_user_domain_idx").on(table.userId, table.domain),
  ],
);

export const sessionCookieScopes = pgTable(
  "session_cookie_scopes",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    uniqueIndex("session_cookie_scopes_session_domain_idx").on(
      table.sessionId,
      table.domain,
    ),
  ],
);

// =============================================================================
// Relations
// =============================================================================

export const browserCookiesRelations = relations(browserCookies, ({ one }) => ({
  user: one(user, {
    fields: [browserCookies.userId],
    references: [user.id],
  }),
}));

export const sessionCookieScopesRelations = relations(
  sessionCookieScopes,
  ({ one }) => ({
    session: one(chatConversations, {
      fields: [sessionCookieScopes.sessionId],
      references: [chatConversations.id],
    }),
  }),
);
