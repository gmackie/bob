import { relations, sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "@bob/auth/schema";
import { chatConversations } from "@bob/chat/schema";
import { projects } from "@bob/projects/schema";
import { workspaces } from "@bob/tenancy/schema";

export const sessionSecrets = pgTable(
  "session_secrets",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    workspaceId: t
      .uuid()
      .references(() => workspaces.id, { onDelete: "set null" }),
    projectId: t
      .uuid()
      .references(() => projects.id, { onDelete: "set null" }),
    label: t.varchar({ length: 128 }).notNull(),
    handle: t.varchar({ length: 64 }).notNull(),
    transport: t.varchar({ length: 32 }).notNull().default("template"),
    source: t.varchar({ length: 32 }).notNull().default("pasted"),
    provider: t.varchar({ length: 32 }).notNull().default("bob"),
    status: t.varchar({ length: 20 }).notNull().default("active"),
    valueCiphertext: t.text(),
    valueIv: t.text(),
    valueTag: t.text(),
    policy: t
      .jsonb()
      .$type<{
        allowedTemplates?: string[];
        redactOutput?: boolean;
        maxUses?: number | null;
        templatePolicies?: Record<
          string,
          {
            allowedArgPrefixes?: Record<string, string[]>;
          }
        >;
      }>()
      .notNull()
      .default({}),
    externalRef: t.text(),
    expiresAt: t.timestamp({ mode: "string", withTimezone: true }),
    lastUsedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("session_secrets_session_idx").on(table.sessionId),
    index("session_secrets_project_idx").on(table.projectId),
    uniqueIndex("session_secrets_session_handle_idx").on(
      table.sessionId,
      table.handle,
    ),
  ],
);

export const sessionSecretUsages = pgTable(
  "session_secret_usages",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    secretId: t
      .uuid()
      .notNull()
      .references(() => sessionSecrets.id, { onDelete: "cascade" }),
    sessionId: t
      .uuid()
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    executor: t.varchar({ length: 32 }).notNull(),
    templateId: t.varchar({ length: 64 }),
    commandPreview: t.text(),
    exitCode: t.integer(),
    durationMs: t.integer(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    index("session_secret_usages_secret_idx").on(table.secretId),
    index("session_secret_usages_session_idx").on(table.sessionId),
  ],
);

export const projectDeploySecretBindings = pgTable(
  "project_deploy_secret_bindings",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    projectId: t
      .uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    label: t.varchar({ length: 128 }).notNull(),
    forgegraphKey: t.varchar({ length: 128 }).notNull(),
    externalRef: t.text().notNull(),
    transport: t.varchar({ length: 32 }).notNull().default("template"),
    templateId: t.varchar({ length: 64 }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "string", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    uniqueIndex("project_deploy_secret_bindings_env_key_idx").on(
      table.projectId,
      table.environment,
      table.forgegraphKey,
    ),
  ],
);

export const sessionSecretsRelations = relations(sessionSecrets, ({ one, many }) => ({
  user: one(user, {
    fields: [sessionSecrets.userId],
    references: [user.id],
  }),
  session: one(chatConversations, {
    fields: [sessionSecrets.sessionId],
    references: [chatConversations.id],
  }),
  workspace: one(workspaces, {
    fields: [sessionSecrets.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [sessionSecrets.projectId],
    references: [projects.id],
  }),
  usages: many(sessionSecretUsages),
}));

export const sessionSecretUsagesRelations = relations(
  sessionSecretUsages,
  ({ one }) => ({
    secret: one(sessionSecrets, {
      fields: [sessionSecretUsages.secretId],
      references: [sessionSecrets.id],
    }),
    session: one(chatConversations, {
      fields: [sessionSecretUsages.sessionId],
      references: [chatConversations.id],
    }),
  }),
);

export const projectDeploySecretBindingsRelations = relations(
  projectDeploySecretBindings,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDeploySecretBindings.projectId],
      references: [projects.id],
    }),
  }),
);
