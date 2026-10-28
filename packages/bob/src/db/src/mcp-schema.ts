import { users } from "@gmacko/core/db/schema/auth";
import { index, pgTable } from "drizzle-orm/pg-core";

import { workspaces } from "@bob/schema/tenancy";

export const mcpOAuthClients = pgTable("mcp_oauth_clients", (t) => ({
  id: t.text().primaryKey(),
  name: t.text().notNull(),
  redirectUris: t.jsonb().$type<string[]>().notNull(),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));
export const mcpOAuthGrants = pgTable(
  "mcp_oauth_grants",
  (t) => ({
    id: t.text().primaryKey(),
    clientId: t
      .text()
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: "cascade" }),
    userId: t
      .text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopes: t.jsonb().$type<string[]>().notNull(),
    resource: t.text().notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
    revokedAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [index("mcp_oauth_grants_user_idx").on(t.userId)],
);
export const mcpOAuthCredentials = pgTable(
  "mcp_oauth_credentials",
  (t) => ({
    hash: t.text().primaryKey(),
    kind: t.text().notNull(),
    grantId: t
      .text()
      .references(() => mcpOAuthGrants.id, { onDelete: "cascade" }),
    data: t.jsonb().$type<Record<string, unknown>>().notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
    usedAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [
    index("mcp_oauth_credentials_expiry_idx").on(t.expiresAt),
    index("mcp_oauth_credentials_grant_idx").on(t.grantId),
  ],
);
