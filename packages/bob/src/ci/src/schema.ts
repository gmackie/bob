// CI/forge tables — moved from @bob/db/schema (Phase 7B-2 Task 17).
import { relations, sql } from "drizzle-orm";
import { pgTable } from "drizzle-orm/pg-core";

import { repositories } from "@bob/projects/schema";
import { workItems, taskRuns } from "@bob/work-items/schema";

// =============================================================================
// ForgeGraph Tables (revisions, builds, deployments, run events)
// =============================================================================

export const forgeRevisionStatusEnum = ["open", "merged", "abandoned"] as const;

export const forgeRevisions = pgTable(
  "forge_revisions",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revId: t.text().notNull(), // commit SHA or JJ changeset ID
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    taskRunId: t.uuid().references(() => taskRuns.id, { onDelete: "set null" }),
    branch: t.text(),
    status: t.varchar({ length: 20 }).notNull().default("open"),
    gates: t.json().$type<Array<{ name: string; status: string; startedAt?: string; finishedAt?: string }>>().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_revisions_repo_idx", columns: [table.repoId] },
    { name: "forge_revisions_task_idx", columns: [table.taskId] },
    { name: "forge_revisions_repo_rev_idx", columns: [table.repoId, table.revId], unique: true },
  ],
);

export const forgeBuildStatusEnum = ["queued", "running", "passed", "failed", "canceled", "superseded"] as const;

export const forgeBuilds = pgTable(
  "forge_builds",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    status: t.varchar({ length: 20 }).notNull().default("queued"),
    idempotencyKey: t.text().notNull(),
    ciProvider: t.text(),
    externalJobId: t.text(),
    imageDigest: t.text(),
    artifactManifestRef: t.text(),
    durationMs: t.integer(),
    startedAt: t.timestamp({ mode: "string", withTimezone: true }),
    finishedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_builds_revision_idx", columns: [table.revisionId] },
    { name: "forge_builds_idempotency_idx", columns: [table.idempotencyKey], unique: true },
  ],
);

export const forgeDeploymentEnvEnum = ["dev", "staging", "prod", "preview"] as const;
export const forgeDeploymentStatusEnum = ["pending_approval", "deploying", "healthy", "unhealthy", "rolled_back", "failed"] as const;

export const forgeDeployments = pgTable(
  "forge_deployments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    buildId: t.uuid().notNull().references(() => forgeBuilds.id, { onDelete: "cascade" }),
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    environment: t.varchar({ length: 20 }).notNull(),
    status: t.varchar({ length: 30 }).notNull().default("pending_approval"),
    rollbackTargetId: t.uuid(), // self-ref to another forgeDeployments.id
    deployedAt: t.timestamp({ mode: "string", withTimezone: true }),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t.timestamp({ mode: "string", withTimezone: true }).$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    { name: "forge_deployments_revision_idx", columns: [table.revisionId] },
    { name: "forge_deployments_env_idx", columns: [table.repoId, table.environment] },
  ],
);

export const forgeRunEventTypeEnum = ["created", "patch_applied", "tests_started", "tests_finished", "approved", "integrated", "failed"] as const;

export const forgeRunEvents = pgTable(
  "forge_run_events",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    runId: t.text().notNull(), // Bob taskRunId
    repoId: t.uuid().notNull().references(() => repositories.id, { onDelete: "cascade" }),
    revisionId: t.uuid().notNull().references(() => forgeRevisions.id, { onDelete: "cascade" }),
    taskId: t.uuid().references(() => workItems.id, { onDelete: "set null" }),
    agentId: t.uuid(), // chatConversation session ID
    eventType: t.varchar({ length: 30 }).notNull(),
    testStatus: t.text(),
    artifactRefs: t.json().$type<Array<{ type: string; url?: string; description?: string }>>().default([]),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
  }),
  (table) => [
    { name: "forge_run_events_run_idx", columns: [table.runId] },
    { name: "forge_run_events_revision_idx", columns: [table.revisionId] },
  ],
);

// ForgeGraph Relations

export const forgeRevisionsRelations = relations(
  forgeRevisions,
  ({ one, many }) => ({
    repository: one(repositories, {
      fields: [forgeRevisions.repoId],
      references: [repositories.id],
    }),
    task: one(workItems, {
      fields: [forgeRevisions.taskId],
      references: [workItems.id],
    }),
    taskRun: one(taskRuns, {
      fields: [forgeRevisions.taskRunId],
      references: [taskRuns.id],
    }),
    builds: many(forgeBuilds),
    deployments: many(forgeDeployments),
    runEvents: many(forgeRunEvents),
  }),
);

export const forgeBuildsRelations = relations(
  forgeBuilds,
  ({ one, many }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeBuilds.revisionId],
      references: [forgeRevisions.id],
    }),
    deployments: many(forgeDeployments),
  }),
);

export const forgeDeploymentsRelations = relations(
  forgeDeployments,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeDeployments.revisionId],
      references: [forgeRevisions.id],
    }),
    build: one(forgeBuilds, {
      fields: [forgeDeployments.buildId],
      references: [forgeBuilds.id],
    }),
  }),
);

export const forgeRunEventsRelations = relations(
  forgeRunEvents,
  ({ one }) => ({
    revision: one(forgeRevisions, {
      fields: [forgeRunEvents.revisionId],
      references: [forgeRevisions.id],
    }),
  }),
);
