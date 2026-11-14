/**
 * Writes for BOB-76 budget telemetry, used by the ws-gateway.
 *
 * Runners send running totals, not increments. Every write here is an upsert
 * that takes the larger of the stored and received value per column, so
 * resending is harmless and a runner that restarted with an empty spool can
 * never shrink a total already recorded.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  budgetAccounts,
  budgetDecisions,
  budgetMeterSamples,
  budgetPolicy,
  budgetPolicyChanges,
  budgetSessionUsage,
  budgetUsageLedger,
  type BudgetMeterJson,
} from "./budget-schema.js";

// Structural inputs: the gateway passes @bob/ws wire objects straight through.
export interface LedgerTokensInput {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface UsageBucketInput {
  hour: string;
  authIndex: string;
  provider: string;
  model: string;
  source: "bob" | "interactive";
  requests: number;
  failed: number;
  tokens: LedgerTokensInput;
}

export interface BobSessionInput {
  sessionId: string;
  authIndex: string;
  provider: string;
  model: string;
  requests: number;
  failed: number;
  tokens: LedgerTokensInput;
  firstAt: string;
  lastAt: string;
  metersFirst?: BudgetMeterJson[];
  metersLast?: BudgetMeterJson[];
}

export interface MeterAccountInput {
  id: string;
  provider: string;
  ref?: { authIndex?: string };
  meters?: BudgetMeterJson[];
  modelMeters?: Record<string, BudgetMeterJson[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<PgQueryResultHKT, any, any>;

const MAX_ROWS = 2_000;

const tokenValues = (tokens: LedgerTokensInput) => ({
  inputTokens: Math.max(0, Math.round(tokens.input)),
  outputTokens: Math.max(0, Math.round(tokens.output)),
  reasoningTokens: Math.max(0, Math.round(tokens.reasoning)),
  cacheReadTokens: Math.max(0, Math.round(tokens.cacheRead)),
  cacheCreationTokens: Math.max(0, Math.round(tokens.cacheCreation)),
  totalTokens: Math.max(0, Math.round(tokens.total)),
});

const greatest = (table: string, column: string) => sql.raw(`greatest(excluded.${column}, ${table}.${column})`);

const counterSet = (table: string) => ({
  requests: greatest(table, "requests"),
  failed: greatest(table, "failed"),
  inputTokens: greatest(table, "input_tokens"),
  outputTokens: greatest(table, "output_tokens"),
  reasoningTokens: greatest(table, "reasoning_tokens"),
  cacheReadTokens: greatest(table, "cache_read_tokens"),
  cacheCreationTokens: greatest(table, "cache_creation_tokens"),
  totalTokens: greatest(table, "total_tokens"),
  updatedAt: sql`now()`,
});

function validTime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at) : undefined;
}

export async function upsertUsageBuckets(
  db: Db,
  input: { workspaceId: string; hostId: string; buckets: readonly UsageBucketInput[] },
): Promise<number> {
  const rows = input.buckets.slice(0, MAX_ROWS).flatMap((bucket) => {
    const hour = validTime(bucket.hour);
    if (!hour || (bucket.source !== "bob" && bucket.source !== "interactive")) return [];
    return [
      {
        workspaceId: input.workspaceId,
        hostId: input.hostId,
        hour,
        authIndex: bucket.authIndex,
        provider: bucket.provider,
        model: bucket.model,
        source: bucket.source,
        requests: Math.max(0, Math.round(bucket.requests)),
        failed: Math.max(0, Math.round(bucket.failed)),
        ...tokenValues(bucket.tokens),
      },
    ];
  });
  if (rows.length === 0) return 0;
  await db
    .insert(budgetUsageLedger)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        budgetUsageLedger.workspaceId,
        budgetUsageLedger.hostId,
        budgetUsageLedger.hour,
        budgetUsageLedger.authIndex,
        budgetUsageLedger.model,
        budgetUsageLedger.source,
      ],
      set: counterSet("budget_usage_ledger"),
    });
  return rows.length;
}

export async function upsertBobSessions(
  db: Db,
  input: { workspaceId: string; hostId: string; sessions: readonly BobSessionInput[] },
): Promise<number> {
  const rows = input.sessions.slice(0, MAX_ROWS).flatMap((session) => {
    const firstAt = validTime(session.firstAt);
    const lastAt = validTime(session.lastAt);
    if (!firstAt || !lastAt || !session.sessionId) return [];
    return [
      {
        workspaceId: input.workspaceId,
        hostId: input.hostId,
        sessionId: session.sessionId,
        authIndex: session.authIndex,
        provider: session.provider,
        model: session.model,
        requests: Math.max(0, Math.round(session.requests)),
        failed: Math.max(0, Math.round(session.failed)),
        ...tokenValues(session.tokens),
        firstAt,
        lastAt,
        metersFirst: session.metersFirst ?? null,
        metersLast: session.metersLast ?? null,
      },
    ];
  });
  if (rows.length === 0) return 0;
  await db
    .insert(budgetSessionUsage)
    .values(rows)
    .onConflictDoUpdate({
      target: [budgetSessionUsage.workspaceId, budgetSessionUsage.sessionId],
      set: {
        ...counterSet("budget_session_usage"),
        firstAt: sql.raw("least(excluded.first_at, budget_session_usage.first_at)"),
        lastAt: sql.raw("greatest(excluded.last_at, budget_session_usage.last_at)"),
        metersFirst: sql.raw(
          "case when excluded.first_at <= budget_session_usage.first_at then coalesce(excluded.meters_first, budget_session_usage.meters_first) else coalesce(budget_session_usage.meters_first, excluded.meters_first) end",
        ),
        metersLast: sql.raw(
          "case when excluded.last_at >= budget_session_usage.last_at then coalesce(excluded.meters_last, budget_session_usage.meters_last) else budget_session_usage.meters_last end",
        ),
      },
    });
  return rows.length;
}

/** One row per distinct observation; the same reading arriving on every heartbeat is stored once. */
export async function recordMeterSamples(
  db: Db,
  input: { workspaceId: string; hostId: string; accounts: readonly MeterAccountInput[] },
): Promise<number> {
  const rows: Array<typeof budgetMeterSamples.$inferInsert> = [];
  const push = (account: MeterAccountInput, model: string, meter: BudgetMeterJson) => {
    const observedAt = validTime(meter.observedAt);
    if (!observedAt || !Number.isFinite(meter.usedPercent)) return;
    rows.push({
      workspaceId: input.workspaceId,
      hostId: input.hostId,
      accountId: account.id,
      authIndex: account.ref?.authIndex ?? null,
      provider: account.provider,
      model,
      windowName: meter.window,
      windowMinutes: meter.windowMinutes ?? null,
      usedPercent: Math.min(100, Math.max(0, meter.usedPercent)),
      resetsAt: validTime(meter.resetsAt) ?? null,
      status: meter.status ?? null,
      observedAt,
    });
  };
  for (const account of input.accounts) {
    for (const meter of account.meters ?? []) push(account, "", meter);
    for (const [model, meters] of Object.entries(account.modelMeters ?? {})) {
      for (const meter of meters) push(account, model, meter);
    }
  }
  if (rows.length === 0) return 0;
  await db.insert(budgetMeterSamples).values(rows.slice(0, MAX_ROWS)).onConflictDoNothing();
  return Math.min(rows.length, MAX_ROWS);
}

// ---------------------------------------------------------------------------
// Phase 2: account states, policy, decisions, and the governor's read model.
// ---------------------------------------------------------------------------

export interface BudgetAccountInput {
  id: string;
  provider: string;
  label: string;
  status: string;
  detail?: string;
  ref?: { authIndex?: string };
}

export async function upsertBudgetAccounts(
  db: Db,
  input: { workspaceId: string; hostId: string; accounts: readonly BudgetAccountInput[] },
): Promise<number> {
  const rows = input.accounts.slice(0, 200).map((account) => ({
    workspaceId: input.workspaceId,
    accountId: account.id,
    hostId: input.hostId,
    authIndex: account.ref?.authIndex ?? null,
    provider: account.provider,
    label: account.label,
    status: account.status,
    detail: account.detail ?? null,
  }));
  if (rows.length === 0) return 0;
  await db
    .insert(budgetAccounts)
    .values(rows)
    .onConflictDoUpdate({
      target: [budgetAccounts.workspaceId, budgetAccounts.accountId],
      set: {
        hostId: sql.raw("excluded.host_id"),
        authIndex: sql.raw("excluded.auth_index"),
        provider: sql.raw("excluded.provider"),
        label: sql.raw("excluded.label"),
        status: sql.raw("excluded.status"),
        detail: sql.raw("excluded.detail"),
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}

const POLICY_ID = "default";

/** The stored policy as written; callers normalize it (normalizeBudgetPolicy in @bob/ws). */
export async function readBudgetPolicy(db: Db): Promise<{ policy: Record<string, unknown>; updatedAt: Date; updatedBy: string | null } | undefined> {
  const rows = await db.select().from(budgetPolicy).where(sql`${budgetPolicy.id} = ${POLICY_ID}`).limit(1);
  const row = rows[0];
  return row ? { policy: row.policy, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : undefined;
}

/** Replace the policy and record the change with its author and note, atomically. */
export async function writeBudgetPolicy(
  db: Db,
  input: { policy: Record<string, unknown>; changedBy: string; note?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.select().from(budgetPolicy).where(sql`${budgetPolicy.id} = ${POLICY_ID}`).for("update");
    await tx
      .insert(budgetPolicy)
      .values({ id: POLICY_ID, policy: input.policy, updatedBy: input.changedBy })
      .onConflictDoUpdate({ target: budgetPolicy.id, set: { policy: input.policy, updatedBy: input.changedBy, updatedAt: sql`now()` } });
    await tx.insert(budgetPolicyChanges).values({
      changedBy: input.changedBy,
      before: before[0]?.policy ?? {},
      after: input.policy,
      note: input.note ?? null,
    });
  });
}

export async function recordBudgetDecision(
  db: Db,
  input: { enforce: boolean; mode: string; totalSlots: number; legacyBudget?: number; dispatched?: number; verdict: Record<string, unknown>; inputs: Record<string, unknown> },
): Promise<void> {
  await db.insert(budgetDecisions).values({
    enforce: input.enforce,
    mode: input.mode,
    totalSlots: input.totalSlots,
    legacyBudget: input.legacyBudget ?? null,
    dispatched: input.dispatched ?? null,
    verdict: input.verdict,
    inputs: input.inputs,
  });
}

/** Raw rows the governor's read model is built from (see assembleBudgetState in @bob/ws). */
export interface BudgetStateRows {
  accounts: Array<{ accountId: string; provider: string; label: string; status: string; detail: string | null; authIndex: string | null; updatedAt: Date }>;
  meters: Array<{ accountId: string; windowName: string; windowMinutes: number | null; usedPercent: number; resetsAt: Date | null; status: string | null; observedAt: Date }>;
  ledger: Array<{ hour: Date; authIndex: string; provider: string; model: string; source: string; requests: number; failed: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number }>;
  sessions: Array<{ sessionId: string; authIndex: string; provider: string; model: string; requests: number; inputTokens: number; outputTokens: number; reasoningTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; firstAt: Date; lastAt: Date }>;
}

export async function readBudgetStateRows(db: Db, input: { now: Date; ledgerHours?: number; sessionDays?: number; accountMaxAgeHours?: number }): Promise<BudgetStateRows> {
  const now = input.now.getTime();
  const ledgerSince = new Date(now - (input.ledgerHours ?? 26) * 3_600_000);
  const sessionSince = new Date(now - (input.sessionDays ?? 7) * 86_400_000);
  const accountSince = new Date(now - (input.accountMaxAgeHours ?? 24) * 3_600_000);
  const [accounts, meters, ledger, sessions] = await Promise.all([
    db.select().from(budgetAccounts).where(sql`${budgetAccounts.updatedAt} >= ${accountSince}`),
    db
      .select()
      .from(budgetMeterSamples)
      .where(sql`${budgetMeterSamples.model} = '' and ${budgetMeterSamples.observedAt} >= ${new Date(now - 8 * 86_400_000)}`)
      .orderBy(budgetMeterSamples.observedAt),
    db.select().from(budgetUsageLedger).where(sql`${budgetUsageLedger.hour} >= ${ledgerSince}`),
    db.select().from(budgetSessionUsage).where(sql`${budgetSessionUsage.lastAt} >= ${sessionSince}`),
  ]);
  return {
    accounts: accounts.map((a) => ({ accountId: a.accountId, provider: a.provider, label: a.label, status: a.status, detail: a.detail, authIndex: a.authIndex, updatedAt: a.updatedAt })),
    meters: meters.map((m) => ({ accountId: m.accountId, windowName: m.windowName, windowMinutes: m.windowMinutes, usedPercent: m.usedPercent, resetsAt: m.resetsAt, status: m.status, observedAt: m.observedAt })),
    ledger: ledger.map((l) => ({ hour: l.hour, authIndex: l.authIndex, provider: l.provider, model: l.model, source: l.source, requests: l.requests, failed: l.failed, inputTokens: l.inputTokens, outputTokens: l.outputTokens, reasoningTokens: l.reasoningTokens, cacheReadTokens: l.cacheReadTokens, cacheCreationTokens: l.cacheCreationTokens, totalTokens: l.totalTokens })),
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, authIndex: s.authIndex, provider: s.provider, model: s.model, requests: s.requests, inputTokens: s.inputTokens, outputTokens: s.outputTokens, reasoningTokens: s.reasoningTokens, cacheReadTokens: s.cacheReadTokens, cacheCreationTokens: s.cacheCreationTokens, totalTokens: s.totalTokens, firstAt: s.firstAt, lastAt: s.lastAt })),
  };
}
