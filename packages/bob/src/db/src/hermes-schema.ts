import { sql } from "drizzle-orm";
import { check, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

export const hermesApprovalConsumptions = pgTable(
  "hermes_approval_consumptions",
  (t) => ({
    approvalId: t.text().primaryKey(),
    proposalId: t.text().notNull(),
    owner: t.varchar({ length: 32 }).notNull(),
    scopeDigest: t.text().notNull(),
    executionId: t.text().notNull(),
    idempotencyKey: t.text().notNull(),
    consumedAt: t.timestamp({ withTimezone: true, mode: "string" }).notNull(),
    expiresAt: t.timestamp({ withTimezone: true, mode: "string" }).notNull(),
  }),
  (table) => [
    uniqueIndex("hermes_approval_consumptions_execution_unique").on(
      table.executionId,
    ),
    uniqueIndex("hermes_approval_consumptions_idempotency_unique").on(
      table.idempotencyKey,
    ),
  ],
);

export const hermesUsageEvents = pgTable(
  "hermes_usage_events",
  (t) => ({
    recordId: t.text().primaryKey(),
    requestIdDigest: t.text().notNull(),
    actorUserIdDigest: t.text().notNull(),
    intent: t.varchar({ length: 32 }).notNull(),
    channel: t.varchar({ length: 32 }).notNull(),
    owner: t.varchar({ length: 32 }).notNull(),
    riskClass: t.varchar({ length: 8 }).notNull(),
    outcome: t.varchar({ length: 32 }).notNull(),
    durationBucket: t.varchar({ length: 16 }).notNull(),
    evidence: t.varchar({ length: 16 }).notNull(),
    observedAt: t.timestamp({ withTimezone: true, mode: "string" }).notNull(),
  }),
  (table) => [
    check(
      "hermes_usage_events_record_digest_check",
      sql`${table.recordId} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check(
      "hermes_usage_events_request_digest_check",
      sql`${table.requestIdDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check(
      "hermes_usage_events_actor_digest_check",
      sql`${table.actorUserIdDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check(
      "hermes_usage_events_intent_check",
      sql`${table.intent} in ('today', 'capture', 'research', 'work', 'approve', 'status', 'fleet', 'close', 'stop')`,
    ),
    check(
      "hermes_usage_events_channel_check",
      sql`${table.channel} in ('telegram', 'console', 'bob')`,
    ),
    check(
      "hermes_usage_events_owner_check",
      sql`${table.owner} in ('ooda', 'bob', 'skillfleet', 'forgegraph')`,
    ),
    check(
      "hermes_usage_events_risk_check",
      sql`${table.riskClass} in ('R0', 'R1', 'R2', 'R3', 'R4')`,
    ),
    check(
      "hermes_usage_events_outcome_check",
      sql`${table.outcome} in ('success', 'failure', 'cancelled', 'blocked', 'replayed', 'policy_rejected')`,
    ),
    check(
      "hermes_usage_events_duration_check",
      sql`${table.durationBucket} in ('<1s', '1-10s', '10-60s', '1-5m', '>5m', 'unknown')`,
    ),
    check(
      "hermes_usage_events_evidence_check",
      sql`${table.evidence} in ('complete', 'partial', 'unknown')`,
    ),
    uniqueIndex("hermes_usage_events_request_observation_unique").on(
      table.requestIdDigest,
      table.observedAt,
    ),
  ],
);
