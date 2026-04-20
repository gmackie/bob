import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { tenants } from "./tenancy.js";
import { projects } from "./projects.js";

// Secrets tables — gmacko-owned. `session_secrets` is the primary encrypted
// secret store (AES-256-GCM ciphertext + IV + auth tag, all base64). The
// encryption itself happens at the `@gmacko/secrets` layer; this schema is
// storage-only. `session_secret_usages` is an append-only audit trail; a row
// is written each time a secret is consumed by an agent session. A soft
// `sessionId` reference (plain uuid, no FK) avoids a cyclic dependency with
// the `chat_conversations` table that lands in Task 8.
// `project_deploy_secret_bindings` maps a stored secret to a
// (projectId FK → projects.id, environment, env var name) triple so deploys
// can materialize the right secret into the right env var without
// hard-coding names. Deleting the underlying project cascades to its
// bindings.

/**
 * Structured policy governing how a stored secret may be used by an agent
 * session. Validated at the `@gmacko/secrets` layer (not at the DB).
 *
 * - `allowedTemplates`: policy template IDs that may read this secret
 * - `allowedArgPrefixes`: per-template required arg prefixes (e.g.
 *   `"git-clone" -> ["https://github.com/acme/"]`)
 * - `maxUses`: absolute cap on lifetime uses (mirrors `usesRemaining` column)
 * - `redactOutput`: whether the agent runner should redact the plaintext
 *   from captured stdout/stderr before streaming to clients
 */
export interface SessionSecretPolicy {
  allowedTemplates?: string[];
  allowedArgPrefixes?: Record<string, string[]>;
  maxUses?: number;
  redactOutput?: boolean;
}

export const sessionSecrets = pgTable(
  "session_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    policy: jsonb("policy")
      .$type<SessionSecretPolicy>()
      .notNull()
      .default({}),
    usesRemaining: integer("uses_remaining"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("session_secrets_tenant_id_idx").on(table.tenantId),
    uniqueTenantName: unique("session_secrets_tenant_name_unique").on(
      table.tenantId,
      table.name,
    ),
  }),
);

export const sessionSecretUsages = pgTable(
  "session_secret_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => sessionSecrets.id, { onDelete: "cascade" }),
    // Soft reference to chat_conversations.id (Task 8). Kept as a bare uuid
    // column without an FK to avoid a cyclic dependency between secrets and
    // sessions schema files. A proper FK can be added once both tables exist.
    sessionId: uuid("session_id"),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    templateId: varchar("template_id", { length: 128 }),
    commandPrefix: text("command_prefix"),
    success: boolean("success").notNull().default(true),
  },
  (table) => ({
    secretIdIdx: index("session_secret_usages_secret_id_idx").on(
      table.secretId,
    ),
    sessionIdIdx: index("session_secret_usages_session_id_idx").on(
      table.sessionId,
    ),
  }),
);

export const projectDeploySecretBindings = pgTable(
  "project_deploy_secret_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    secretId: uuid("secret_id")
      .notNull()
      .references(() => sessionSecrets.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deployEnvironment: varchar("deploy_environment", { length: 64 }).notNull(),
    deployEnvVarName: varchar("deploy_env_var_name", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("project_deploy_secret_bindings_tenant_id_idx").on(
      table.tenantId,
    ),
    secretIdIdx: index("project_deploy_secret_bindings_secret_id_idx").on(
      table.secretId,
    ),
    projectIdIdx: index("project_deploy_secret_bindings_project_id_idx").on(
      table.projectId,
    ),
    uniqueBinding: unique("project_deploy_secret_bindings_unique").on(
      table.tenantId,
      table.projectId,
      table.deployEnvironment,
      table.deployEnvVarName,
    ),
  }),
);

// drizzle-zod schemas for RPC validation
export const sessionSecretsInsertSchema = createInsertSchema(sessionSecrets);
export const sessionSecretsSelectSchema = createSelectSchema(sessionSecrets);
export const sessionSecretUsagesInsertSchema = createInsertSchema(
  sessionSecretUsages,
);
export const sessionSecretUsagesSelectSchema = createSelectSchema(
  sessionSecretUsages,
);
export const projectDeploySecretBindingsInsertSchema = createInsertSchema(
  projectDeploySecretBindings,
);
export const projectDeploySecretBindingsSelectSchema = createSelectSchema(
  projectDeploySecretBindings,
);

// Row type exports
export type SessionSecret = typeof sessionSecrets.$inferSelect;
export type NewSessionSecret = typeof sessionSecrets.$inferInsert;
export type SessionSecretUsage = typeof sessionSecretUsages.$inferSelect;
export type NewSessionSecretUsage = typeof sessionSecretUsages.$inferInsert;
export type ProjectDeploySecretBinding =
  typeof projectDeploySecretBindings.$inferSelect;
export type NewProjectDeploySecretBinding =
  typeof projectDeploySecretBindings.$inferInsert;
