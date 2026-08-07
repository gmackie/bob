import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { conversations, oodaSchema, sensitivityEnum } from "./conversations";

export const agentJobs = oodaSchema.table(
  "agent_jobs",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    class: t.varchar({ length: 64 }).notNull(),
    status: t.varchar({ length: 32 }).notNull().default("queued"),
    provider: t.varchar({ length: 64 }).notNull(),
    capabilities: t.text().array().notNull().default([]),
    deadlineSeconds: t.integer().notNull(),
    aggregateTokenBudget: t.integer().notNull(),
    contextPackId: t.uuid(),
    correlationId: t.text().notNull(),
    idempotencyKey: t.text().notNull(),
    lastSequence: t.bigint({ mode: "number" }).notNull().default(0),
    claimedBy: t.text(),
    leaseExpiresAt: t.timestamp({ withTimezone: true }),
    lastHeartbeatAt: t.timestamp({ withTimezone: true }),
    cancellationRequestedAt: t.timestamp({ withTimezone: true }),
    cancelIdempotencyKey: t.text(),
    tokensUsed: t.integer().notNull().default(0),
    sandboxRef: t.text(),
    error: t.text(),
    result: t.jsonb().$type<Record<string, unknown>>(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    startedAt: t.timestamp({ withTimezone: true }),
    completedAt: t.timestamp({ withTimezone: true }),
    expiresAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [
    uniqueIndex("agent_jobs_conversation_idempotency_uidx").on(
      t.conversationId,
      t.idempotencyKey,
    ),
    index("agent_jobs_conversation_status_idx").on(t.conversationId, t.status),
    index("agent_jobs_status_lease_idx").on(t.status, t.leaseExpiresAt),
  ],
);

export const agentJobEvents = oodaSchema.table(
  "agent_job_events",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    agentJobId: t
      .uuid()
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    sequence: t.bigint({ mode: "bigint" }).notNull(),
    type: t.varchar({ length: 64 }).notNull(),
    payload: t.jsonb().$type<Record<string, unknown>>().notNull(),
    idempotencyKey: t.text().notNull(),
    occurredAt: t.timestamp({ withTimezone: true }).notNull(),
    recordedAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("agent_job_events_job_sequence_uidx").on(
      t.agentJobId,
      t.sequence,
    ),
    uniqueIndex("agent_job_events_job_idempotency_uidx").on(
      t.agentJobId,
      t.idempotencyKey,
    ),
  ],
);

export const contextPacks = oodaSchema.table(
  "context_packs",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    provider: t.varchar({ length: 64 }).notNull(),
    purpose: t.varchar({ length: 64 }).notNull(),
    policySnapshot: t.jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: t.timestamp({ withTimezone: true }),
  }),
  (t) => [
    index("context_packs_conversation_created_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  ],
);

export const contextItems = oodaSchema.table(
  "context_items",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    contextPackId: t
      .uuid()
      .notNull()
      .references(() => contextPacks.id, { onDelete: "cascade" }),
    sourceType: t.varchar({ length: 64 }).notNull(),
    sourceId: t.text().notNull(),
    sensitivity: sensitivityEnum().notNull(),
    decision: t.varchar({ length: 32 }).notNull(),
    reason: t.text().notNull(),
    content: t.text(),
    redaction: t.text(),
    ordinal: t.integer().notNull(),
  }),
  (t) => [
    uniqueIndex("context_items_pack_ordinal_uidx").on(
      t.contextPackId,
      t.ordinal,
    ),
  ],
);

export const proposals = oodaSchema.table(
  "proposals",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    conversationId: t
      .uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    kind: t.varchar({ length: 64 }).notNull(),
    destination: t.varchar({ length: 128 }).notNull(),
    status: t.varchar({ length: 32 }).notNull().default("draft"),
    risk: t.varchar({ length: 32 }).notNull(),
    preview: t.jsonb().$type<Record<string, unknown>>().notNull(),
    rationale: t.text().notNull(),
    confidence: t.real().notNull(),
    policySnapshot: t.jsonb().$type<Record<string, unknown>>().notNull(),
    idempotencyKey: t.text().notNull(),
    commandFingerprint: t.text().notNull(),
    version: t.integer().notNull().default(1),
    expiresAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: t
      .timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  }),
  (t) => [
    index("proposals_conversation_status_idx").on(t.conversationId, t.status),
    index("proposals_destination_status_idx").on(t.destination, t.status),
    uniqueIndex("proposals_conversation_idempotency_uidx").on(
      t.conversationId,
      t.idempotencyKey,
    ),
  ],
);

export const approvalDecisions = oodaSchema.table(
  "approval_decisions",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    proposalId: t
      .uuid()
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    decision: t.varchar({ length: 16 }).notNull(),
    expectedVersion: t.integer().notNull(),
    scope: t.varchar({ length: 32 }).notNull().default("single_delivery"),
    rationale: t.text(),
    decidedBy: t.text().notNull(),
    decidedAt: t.timestamp({ withTimezone: true }).notNull(),
    recordedAt: t.timestamp({ withTimezone: true }).notNull().defaultNow(),
  }),
  (t) => [
    uniqueIndex("approval_decisions_proposal_version_uidx").on(
      t.proposalId,
      t.expectedVersion,
    ),
  ],
);
