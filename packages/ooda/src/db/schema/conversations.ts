import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { index, pgSchema, uniqueIndex } from "drizzle-orm/pg-core";

export const oodaSchema = pgSchema("ooda");

export const conversationStatusEnum = oodaSchema.enum("conversation_status", [
  "active",
  "archived",
]);

export const sensitivityEnum = oodaSchema.enum("sensitivity", [
  "general",
  "personal",
  "sensitive",
  "restricted",
]);

export const ttsPolicyEnum = oodaSchema.enum("tts_policy", [
  "allowed",
  "manual",
  "disabled",
  "sensitive_denied",
]);

export const conversations = oodaSchema.table(
  "conversations",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    ownerId: t.text().notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    status: conversationStatusEnum().notNull().default("active"),
    hostProvider: t.varchar({ length: 64 }).notNull().default("grok"),
    hostProfile: t.varchar({ length: 128 }).notNull().default("daily"),
    activeBranchId: t.uuid(),
    // PostgreSQL owns the monotonic bigint. `number` mode avoids a drizzle-kit
    // snapshot serialization bug for bigint defaults; public contracts still
    // encode sequences as decimal strings.
    lastSequence: t.bigint({ mode: "number" }).notNull().default(0),
    sensitivityCeiling: sensitivityEnum().notNull().default("personal"),
    ttsPolicy: ttsPolicyEnum().notNull().default("allowed"),
    creationIdempotencyKey: t.text(),
    creationFingerprint: t.text(),
    migrationMetadata: t.jsonb().$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    index("conversations_owner_updated_idx").on(t.ownerId, t.updatedAt),
    index("conversations_owner_status_idx").on(t.ownerId, t.status),
    uniqueIndex("conversations_owner_creation_idempotency_uidx").on(
      t.ownerId,
      t.creationIdempotencyKey,
    ),
  ],
);

export const conversationBranches = oodaSchema.table(
  "conversation_branches",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentBranchId: t.uuid().references(
      (): AnyPgColumn => conversationBranches.id,
      { onDelete: "set null" },
    ),
    forkEventId: t.uuid(),
    name: t.varchar({ length: 256 }).notNull(),
    reason: t.text(),
    idempotencyKey: t.text(),
    commandFingerprint: t.text(),
    migrationMetadata: t.jsonb().$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    index("conversation_branches_conversation_idx").on(t.conversationId),
    uniqueIndex("conversation_branches_conversation_name_uidx").on(
      t.conversationId,
      t.name,
    ),
    uniqueIndex("conversation_branches_conversation_idempotency_uidx").on(
      t.conversationId,
      t.idempotencyKey,
    ),
  ],
);

export const conversationEvents = oodaSchema.table(
  "conversation_events",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    branchId: t
      .uuid()
      .notNull()
      .references(() => conversationBranches.id, { onDelete: "cascade" }),
    sequence: t.bigint({ mode: "bigint" }).notNull(),
    type: t.varchar({ length: 64 }).notNull(),
    actorType: t.varchar({ length: 32 }).notNull(),
    actorId: t.text(),
    payload: t.jsonb().$type<Record<string, unknown>>().notNull(),
    sensitivity: sensitivityEnum().notNull().default("general"),
    correlationId: t.text().notNull(),
    causationId: t.text(),
    idempotencyKey: t.text(),
    occurredAt: t.timestamp({ withTimezone: true }).notNull(),
    recordedAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("conversation_events_conversation_sequence_uidx").on(
      t.conversationId,
      t.sequence,
    ),
    uniqueIndex("conversation_events_conversation_idempotency_uidx").on(
      t.conversationId,
      t.idempotencyKey,
    ),
    index("conversation_events_branch_sequence_idx").on(
      t.branchId,
      t.sequence,
    ),
    index("conversation_events_correlation_idx").on(t.correlationId),
  ],
);
