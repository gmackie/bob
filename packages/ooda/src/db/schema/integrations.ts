import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { conversations, oodaSchema } from "./conversations";
import { proposals } from "./orchestration";

export const externalLinks = oodaSchema.table(
  "external_links",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .references(() => conversations.id, { onDelete: "cascade" }),
    proposalId: t
      .uuid()
      .references(() => proposals.id, { onDelete: "set null" }),
    destination: t.varchar({ length: 128 }).notNull(),
    externalType: t.varchar({ length: 128 }).notNull(),
    externalId: t.text().notNull(),
    deepLink: t.text().notNull(),
    idempotencyKey: t.text().notNull(),
    status: t.varchar({ length: 32 }).notNull().default("active"),
    metadata: t.jsonb().$type<Record<string, unknown>>().notNull().default({}),
    statusObservedAt: t.timestamp({ withTimezone: true }),
    statusClaimedAt: t.timestamp({ withTimezone: true }),
    statusClaimedBy: t.text(),
    statusError: t.text(),
    nextStatusCheckAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("external_links_destination_idempotency_uidx").on(
      t.destination,
      t.idempotencyKey,
    ),
    index("external_links_conversation_idx").on(t.conversationId),
    index("external_links_proposal_idx").on(t.proposalId),
    index("external_links_status_check_idx").on(t.status, t.nextStatusCheckAt),
  ],
);

export const integrationOutbox = oodaSchema.table(
  "integration_outbox",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    proposalId: t
      .uuid()
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    destination: t.varchar({ length: 128 }).notNull(),
    idempotencyKey: t.text().notNull(),
    payload: t.jsonb().$type<Record<string, unknown>>().notNull(),
    status: t.varchar({ length: 32 }).notNull().default("pending"),
    attemptCount: t.integer().notNull().default(0),
    availableAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    claimedAt: t.timestamp({ withTimezone: true }),
    claimedBy: t.text(),
    deliveredAt: t.timestamp({ withTimezone: true }),
    lastError: t.text(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    uniqueIndex("integration_outbox_idempotency_uidx").on(t.idempotencyKey),
    index("integration_outbox_status_available_idx").on(
      t.status,
      t.availableAt,
    ),
  ],
);

export const deliveryAttempts = oodaSchema.table(
  "delivery_attempts",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    outboxId: t
      .uuid()
      .notNull()
      .references(() => integrationOutbox.id, { onDelete: "cascade" }),
    attempt: t.integer().notNull(),
    status: t.varchar({ length: 32 }).notNull(),
    error: t.text(),
    receipt: t.jsonb().$type<Record<string, unknown>>(),
    startedAt: t.timestamp({ withTimezone: true }).notNull(),
    finishedAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [
    uniqueIndex("delivery_attempts_outbox_attempt_uidx").on(
      t.outboxId,
      t.attempt,
    ),
  ],
);

export const deadLetters = oodaSchema.table(
  "dead_letters",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    outboxId: t
      .uuid()
      .notNull()
      .references(() => integrationOutbox.id, { onDelete: "cascade" }),
    reason: t.text().notNull(),
    payload: t.jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    repairedAt: t.timestamp({ withTimezone: true }),
    repairedBy: t.text(),
    repairNote: t.text(),
    repairIdempotencyKey: t.text(),
  }),
  (t) => [
    index("dead_letters_outbox_idx").on(t.outboxId),
    uniqueIndex("dead_letters_repair_idempotency_uidx").on(
      t.repairIdempotencyKey,
    ),
    index("dead_letters_unrepaired_idx").on(t.repairedAt),
  ],
);
