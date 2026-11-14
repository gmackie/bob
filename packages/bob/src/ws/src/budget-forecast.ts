/**
 * Turns recorded meters, ledger buckets and Bob session totals into the
 * per-account rates the governor needs (BOB-76). Pure.
 *
 * - burn rate: weekly meter movement over the lookback, using only readings
 *   inside the same weekly window (a reset in between would read as negative)
 * - interactive rate: burn rate × interactive share of weighted tokens
 * - % per weighted token: meter movement ÷ weighted tokens of every source
 * - cost per run: median Bob session weighted tokens × % per weighted token
 * - run length: median Bob session duration
 *
 * Token weights follow the relative list prices of Anthropic and OpenAI
 * models (output ≈ 5× input, cache writes 1.25×, cache reads 0.1×); the
 * regression absorbs the absolute scale, only the ratios matter.
 */
import type { LedgerTokens, UsageSource } from "./budget-meters";

export interface ForecastMeterSample {
  usedPercent: number;
  resetsAt?: string;
  observedAt: string;
}

export interface ForecastLedgerRow {
  hour: string;
  source: UsageSource;
  tokens: LedgerTokens;
}

export interface ForecastSession {
  firstAt: string;
  lastAt: string;
  tokens: LedgerTokens;
}

export interface ForecastFallbacks {
  costPerRunPct: number;
  runHours: number;
  interactivePctPerHour: number;
}

export interface AccountRates {
  burnPctPerHour: number;
  interactivePctPerHour: number;
  pctPerWeightedToken?: number;
  costPerRunPct: number;
  runHours: number;
  /** True when any rate came from a fallback rather than data. */
  estimated: boolean;
  notes: string[];
}

export const DEFAULT_FORECAST_FALLBACKS: ForecastFallbacks = { costPerRunPct: 1, runHours: 0.5, interactivePctPerHour: 0.1 };

export function weightedTokens(t: LedgerTokens): number {
  return t.input + t.output * 5 + t.cacheCreation * 1.25 + t.cacheRead * 0.1;
}

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export function estimateAccountRates(input: {
  meters: readonly ForecastMeterSample[];
  ledger: readonly ForecastLedgerRow[];
  sessions: readonly ForecastSession[];
  now: Date;
  lookbackHours?: number;
  fallbacks?: ForecastFallbacks;
}): AccountRates {
  const fallbacks = input.fallbacks ?? DEFAULT_FORECAST_FALLBACKS;
  const lookbackMs = (input.lookbackHours ?? 24) * 3_600_000;
  const since = input.now.getTime() - lookbackMs;
  const notes: string[] = [];
  let estimated = false;

  // Meter movement within one weekly window.
  const readings = input.meters
    .map((m) => ({ ...m, at: Date.parse(m.observedAt) }))
    .filter((m) => Number.isFinite(m.at) && m.at >= since - 3_600_000 && Number.isFinite(m.usedPercent))
    .sort((a, b) => a.at - b.at);
  const latest = readings.at(-1);
  const sameWindow = latest ? readings.filter((m) => m.resetsAt === latest.resetsAt) : [];
  const first = sameWindow[0];
  let burnPctPerHour: number | undefined;
  let movedPct: number | undefined;
  let windowStart = since;
  if (first && latest && latest.at - first.at >= 2 * 3_600_000) {
    movedPct = Math.max(0, latest.usedPercent - first.usedPercent);
    burnPctPerHour = movedPct / ((latest.at - first.at) / 3_600_000);
    windowStart = first.at;
  } else {
    notes.push("not enough meter history in one window");
  }

  const inWindow = input.ledger.filter((row) => {
    const at = Date.parse(row.hour);
    return Number.isFinite(at) && at + 3_600_000 > windowStart && at <= input.now.getTime();
  });
  const weighted = { bob: 0, interactive: 0 };
  for (const row of inWindow) weighted[row.source] += weightedTokens(row.tokens);
  const totalWeighted = weighted.bob + weighted.interactive;

  let interactivePctPerHour: number;
  let pctPerWeightedToken: number | undefined;
  if (burnPctPerHour === undefined) {
    interactivePctPerHour = fallbacks.interactivePctPerHour;
    estimated = true;
  } else if (totalWeighted > 0) {
    interactivePctPerHour = burnPctPerHour * (weighted.interactive / totalWeighted);
    if (movedPct !== undefined && movedPct > 0) pctPerWeightedToken = movedPct / totalWeighted;
  } else {
    // The meter moved with no recorded tokens: use the proxy didn't see (claude.ai, another client).
    interactivePctPerHour = burnPctPerHour;
    if (burnPctPerHour > 0) notes.push("meter moved without proxy traffic; counted as interactive");
  }

  const recentSessions = input.sessions.filter((s) => Date.parse(s.lastAt) >= input.now.getTime() - 7 * 24 * 3_600_000);
  const sessionWeights = recentSessions.map((s) => weightedTokens(s.tokens)).filter((w) => w > 0);
  const medianWeight = median(sessionWeights);
  let costPerRunPct: number;
  if (pctPerWeightedToken !== undefined && medianWeight !== undefined) {
    costPerRunPct = medianWeight * pctPerWeightedToken;
  } else {
    costPerRunPct = fallbacks.costPerRunPct;
    estimated = true;
    notes.push("cost per run from fallback");
  }
  const durations = recentSessions
    .map((s) => (Date.parse(s.lastAt) - Date.parse(s.firstAt)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h > 0);
  const runHours = median(durations) ?? fallbacks.runHours;
  if (durations.length === 0) {
    estimated = true;
    notes.push("run length from fallback");
  }

  return {
    burnPctPerHour: burnPctPerHour ?? 0,
    interactivePctPerHour,
    ...(pctPerWeightedToken !== undefined ? { pctPerWeightedToken } : {}),
    costPerRunPct,
    runHours,
    estimated,
    notes,
  };
}
