// BOB-76 subscription budget telemetry. DDL: drizzle/0038_budget_telemetry.sql.
import { bigint, index, integer, pgTable, primaryKey } from "drizzle-orm/pg-core";

export interface BudgetMeterJson {
  window: string;
  windowMinutes?: number;
  usedPercent: number;
  resetsAt?: string;
  status?: string;
  observedAt: string;
}

export const budgetMeterSamples = pgTable(
  "budget_meter_samples",
  (t) => ({
    workspaceId: t.uuid().notNull(),
    hostId: t.text().notNull(),
    accountId: t.text().notNull(),
    authIndex: t.text(),
    provider: t.text().notNull(),
    model: t.text().notNull().default(""),
    windowName: t.text().notNull(),
    windowMinutes: t.integer(),
    usedPercent: t.real().notNull(),
    resetsAt: t.timestamp({ withTimezone: true }),
    status: t.text(),
    observedAt: t.timestamp({ withTimezone: true }).notNull(),
    receivedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.accountId, t.model, t.windowName, t.observedAt] }),
    index("budget_meter_samples_recent_idx").on(t.workspaceId, t.provider, t.observedAt),
  ],
);

const tokenColumns = () => ({
  requests: integer().notNull().default(0),
  failed: integer().notNull().default(0),
  inputTokens: bigint({ mode: "number" }).notNull().default(0),
  outputTokens: bigint({ mode: "number" }).notNull().default(0),
  reasoningTokens: bigint({ mode: "number" }).notNull().default(0),
  cacheReadTokens: bigint({ mode: "number" }).notNull().default(0),
  cacheCreationTokens: bigint({ mode: "number" }).notNull().default(0),
  totalTokens: bigint({ mode: "number" }).notNull().default(0),
});

export const budgetUsageLedger = pgTable(
  "budget_usage_ledger",
  (t) => ({
    workspaceId: t.uuid().notNull(),
    hostId: t.text().notNull(),
    hour: t.timestamp({ withTimezone: true }).notNull(),
    authIndex: t.text().notNull(),
    provider: t.text().notNull(),
    model: t.text().notNull(),
    source: t.text().$type<"bob" | "interactive">().notNull(),
    ...tokenColumns(),
    updatedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.hostId, t.hour, t.authIndex, t.model, t.source] }),
    index("budget_usage_ledger_hour_idx").on(t.workspaceId, t.hour),
  ],
);

export const budgetSessionUsage = pgTable(
  "budget_session_usage",
  (t) => ({
    workspaceId: t.uuid().notNull(),
    hostId: t.text().notNull(),
    sessionId: t.text().notNull(),
    authIndex: t.text().notNull(),
    provider: t.text().notNull(),
    model: t.text().notNull(),
    ...tokenColumns(),
    firstAt: t.timestamp({ withTimezone: true }).notNull(),
    lastAt: t.timestamp({ withTimezone: true }).notNull(),
    metersFirst: t.jsonb().$type<BudgetMeterJson[]>(),
    metersLast: t.jsonb().$type<BudgetMeterJson[]>(),
    updatedAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.sessionId] }),
    index("budget_session_usage_last_idx").on(t.workspaceId, t.lastAt),
  ],
);
