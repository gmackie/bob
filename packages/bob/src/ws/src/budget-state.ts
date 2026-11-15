/**
 * The budget read model (BOB-76): one serializable snapshot of everything the
 * governor looks at. The server builds it from the database, autoDrain feeds
 * it to the governor, and the dashboard receives the same snapshot and re-runs
 * the governor locally while levers are dragged — so a preview can never
 * disagree with what the server would decide.
 */
import { estimateAccountRates, type AccountRates, type ForecastFallbacks } from "./budget-forecast";
import { governBudget, normalizeBudgetPolicy, type BudgetPolicy, type BudgetVerdict, type GovernorAccountInput, type MeterReading } from "./budget-governor";
import type { LedgerTokens, UsageSource } from "./budget-meters";

export interface BudgetStateAccount {
  accountId: string;
  provider: string;
  label: string;
  status: string;
  detail?: string;
  authIndex?: string;
  updatedAt: string;
}

export interface BudgetStateMeter {
  accountId: string;
  window: string;
  windowMinutes?: number;
  usedPercent: number;
  resetsAt?: string;
  status?: string;
  observedAt: string;
}

export interface BudgetStateLedgerRow {
  hour: string;
  authIndex: string;
  provider: string;
  model: string;
  source: UsageSource;
  requests: number;
  failed: number;
  tokens: LedgerTokens;
}

export interface BudgetStateSession {
  sessionId: string;
  authIndex: string;
  provider: string;
  model: string;
  requests: number;
  tokens: LedgerTokens;
  firstAt: string;
  lastAt: string;
}

export interface BudgetStateWire {
  at: string;
  policy: BudgetPolicy;
  accounts: BudgetStateAccount[];
  /** Account-level meter history (model ''), oldest first. */
  meters: BudgetStateMeter[];
  ledger: BudgetStateLedgerRow[];
  sessions: BudgetStateSession[];
  /** Bob runs in flight per provider (claude, codex, …). */
  activeByProvider: Record<string, number>;
}

export interface AssembledAccount {
  input: GovernorAccountInput;
  rates: AccountRates;
  label: string;
  detail?: string;
  weekly?: BudgetStateMeter;
  short?: BudgetStateMeter;
}

const SHORT_WINDOWS = new Set(["5h"]);
const statusOf = (status: string): GovernorAccountInput["status"] =>
  status === "ready" || status === "cooldown" || status === "disabled" ? status : "error";

export function assembleGovernorInputs(state: BudgetStateWire, now: Date, fallbacks?: ForecastFallbacks): AssembledAccount[] {
  // Bob runs are spread by the proxy across a provider's ready accounts.
  const readyByProvider = new Map<string, string[]>();
  for (const account of state.accounts) {
    if (account.status !== "ready") continue;
    readyByProvider.set(account.provider, [...(readyByProvider.get(account.provider) ?? []), account.accountId]);
  }
  const activeFor = (account: BudgetStateAccount): number => {
    const ready = readyByProvider.get(account.provider) ?? [];
    const index = ready.indexOf(account.accountId);
    if (index < 0) return 0;
    const total = Math.max(0, Math.floor(state.activeByProvider[account.provider] ?? 0));
    return Math.floor(total / ready.length) + (index < total % ready.length ? 1 : 0);
  };

  return state.accounts.map((account) => {
    const mine = state.meters.filter((m) => m.accountId === account.accountId);
    const weeklyHistory = mine.filter((m) => m.window === "weekly");
    const weekly = weeklyHistory.at(-1);
    const short = mine.filter((m) => SHORT_WINDOWS.has(m.window)).at(-1);
    const ledger = account.authIndex ? state.ledger.filter((row) => row.authIndex === account.authIndex) : [];
    const sessions = account.authIndex ? state.sessions.filter((s) => s.authIndex === account.authIndex) : [];
    const rates = estimateAccountRates({
      meters: weeklyHistory.map((m) => ({ usedPercent: m.usedPercent, ...(m.resetsAt ? { resetsAt: m.resetsAt } : {}), observedAt: m.observedAt })),
      ledger: ledger.map((row) => ({ hour: row.hour, source: row.source, tokens: row.tokens })),
      sessions: sessions.map((s) => ({ firstAt: s.firstAt, lastAt: s.lastAt, tokens: s.tokens })),
      now,
      ...(fallbacks ? { fallbacks } : {}),
    });
    const toReading = (m: BudgetStateMeter): MeterReading => ({
      usedPercent: m.usedPercent,
      observedAt: m.observedAt,
      ...(m.resetsAt ? { resetsAt: m.resetsAt } : {}),
      ...(m.windowMinutes ? { windowMinutes: m.windowMinutes } : {}),
    });
    const input: GovernorAccountInput = {
      accountId: account.accountId,
      provider: account.provider,
      status: statusOf(account.status),
      ...(weekly ? { weekly: toReading(weekly) } : {}),
      ...(short ? { short: toReading(short) } : {}),
      interactivePctPerHour: rates.interactivePctPerHour,
      costPerRunPct: rates.costPerRunPct,
      runHours: rates.runHours,
      activeBobRuns: activeFor(account),
    };
    return { input, rates, label: account.label, ...(account.detail ? { detail: account.detail } : {}), ...(weekly ? { weekly } : {}), ...(short ? { short } : {}) };
  });
}

/** Govern a snapshot, optionally under a draft policy (the dashboard's what-if). */
export function governState(state: BudgetStateWire, now: Date, policyOverride?: unknown): { verdict: BudgetVerdict; assembled: AssembledAccount[] } {
  const assembled = assembleGovernorInputs(state, now);
  const policy = policyOverride === undefined ? state.policy : normalizeBudgetPolicy(policyOverride);
  return { verdict: governBudget(assembled.map((a) => a.input), policy, now), assembled };
}
