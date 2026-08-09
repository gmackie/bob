import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { oodaSchema } from "./conversations";

export const migrationRunStatusEnum = oodaSchema.enum("migration_run_status", [
  "pending",
  "copying",
  "embedding",
  "verifying",
  "completed",
  "failed",
]);

export const migrationRuns = oodaSchema.table(
  "migration_runs",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerId: t.text().notNull(),
    source: t.varchar({ length: 128 }).notNull(),
    sourceFingerprint: t.text().notNull(),
    status: migrationRunStatusEnum().notNull().default("pending"),
    phase: t.varchar({ length: 64 }).notNull().default("inventory"),
    cursor: t.text(),
    sourceCounts: t
      .jsonb()
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    destinationCounts: t
      .jsonb()
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    verification: t.jsonb().$type<Record<string, unknown>>(),
    lastError: t.text(),
    startedAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: t.timestamp({ withTimezone: true }),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("migration_runs_source_fingerprint_uidx").on(
      t.ownerId,
      t.source,
      t.sourceFingerprint,
    ),
    index("migration_runs_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export const migrationRecords = oodaSchema.table(
  "migration_records",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    runId: t
      .uuid()
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    entityType: t.varchar({ length: 64 }).notNull(),
    sourceId: t.text().notNull(),
    destinationTable: t.varchar({ length: 128 }).notNull(),
    destinationId: t.text().notNull(),
    contentHash: t.text(),
    metadata: t.jsonb().$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("migration_records_source_entity_uidx").on(
      t.runId,
      t.entityType,
      t.sourceId,
    ),
    index("migration_records_destination_idx").on(
      t.destinationTable,
      t.destinationId,
    ),
  ],
);
