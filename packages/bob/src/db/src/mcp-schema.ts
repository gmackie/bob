import { users } from "@gmacko/core/db/schema/auth";
import { index, pgTable, primaryKey } from "drizzle-orm/pg-core";

import { workspaces } from "@bob/schema/tenancy";
import { workItems } from "@bob/schema/work-items";

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

export const bizpulseMcpLink = pgTable(
  "bizpulse_mcp_link",
  (t) => ({
    id: t.text().primaryKey(),
    userId: t
      .text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    origin: t.text().notNull(),
    envelope: t
      .jsonb()
      .$type<{ ciphertext: string; iv: string; tag: string }>()
      .notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [index("bizpulse_mcp_link_owner_idx").on(t.userId, t.workspaceId)],
);

export const bizpulseMcpConsent = pgTable(
  "bizpulse_mcp_consent",
  (t) => ({
    stateHash: t.text().primaryKey(),
    userId: t
      .text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    origin: t.text().notNull(),
    envelope: t
      .jsonb()
      .$type<{ ciphertext: string; iv: string; tag: string }>()
      .notNull(),
    expiresAt: t.timestamp({ withTimezone: true }).notNull(),
  }),
  (t) => [index("bizpulse_mcp_consent_expiry_idx").on(t.expiresAt)],
);

/** A person's approval to dispatch a work item from the MCP planning review. */
export const mcpDispatchApprovals = pgTable("mcp_dispatch_approvals", (t) => ({
  workItemId: t
    .uuid()
    .primaryKey()
    .references(() => workItems.id, { onDelete: "cascade" }),
  workspaceId: t
    .uuid()
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  approvedBy: t
    .text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  approvedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  dispatchedAt: t.timestamp({ withTimezone: true }),
}));

/** Manual MCP links are independent of a work item's synced tracker identity. */
export const mcpLinearLinks = pgTable("mcp_linear_links", (t) => ({
  workspaceId: t.uuid().notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  workItemId: t.uuid().notNull().references(() => workItems.id, { onDelete: "cascade" }),
  linearIssueId: t.text().notNull(),
  linearProjectId: t.text(),
  updatedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}), (t) => [primaryKey({ columns: [t.workspaceId, t.workItemId] })]);
