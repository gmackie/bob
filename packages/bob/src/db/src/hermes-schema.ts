import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";

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
