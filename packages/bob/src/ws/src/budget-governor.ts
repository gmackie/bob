/**
 * The subscription budget governor (BOB-76). Pure: every input — time, meters,
 * forecasts, policy — is passed in, so the server, the replay tests and the
 * dashboard's live lever simulation all run this exact function.
 *
 * Per account, each tick:
 *   1. used  = the provider's weekly meter (stale → padded; reset passed → 0)
 *   2. Î     = forecast interactive use until reset
 *   3. S     = max(0, landing − used − effective reserve − Î)
 *      (the reserve releases linearly over the final window before reset)
 *   4. rate  = S spread over the time to (reset − landing buffer), shaped by the
 *              pace profile and the mode (pause → 0, boost → ×factor)
 *   5. slots = floor(rate × run hours ÷ cost per run) − Bob runs in flight
 *              (Little's law: the concurrency that spends at that rate)
 * Guards zero an account outright: not ready, disabled in policy, inside the
 * landing buffer, or its metered 5-hour window above the ceiling.
 */

export type BudgetMode = "run" | "pause" | "boost";
export type PaceShape = "even" | "working-hours" | "front-load" | "back-load";
export type BudgetTier = "delivery" | "groom" | "pull-forward" | "discovery" | "bizpulse";

export interface AccountPolicy {
  enabled?: boolean;
  reservePct?: number;
  shortCeilingPct?: number;
  landingPct?: number;
}

export interface TierPolicy {
  tier: BudgetTier;
  enabled: boolean;
  /** Max share (0–1) of the surplus this tier may take. Delivery ignores it. */
  maxShare: number;
  /** Optional model override for runs in this tier. */
  model?: string;
}

export interface BudgetPolicy {
  /** Shadow until true: the governor decides and records, autoDrain ignores it. */
  enforce: boolean;
  mode: BudgetMode;
  modeUntil?: string;
  boostFactor: number;
  reservePct: number;
  shortCeilingPct: number;
  landingPct: number;
  landingBufferHours: number;
  releaseWindowHours: number;
  paceShape: PaceShape;
  /** Owner's UTC offset, for working-hours pacing. */
  tzOffsetMinutes: number;
  staleAfterMinutes: number;
  staleMarginPct: number;
  unmeteredConcurrency: number;
  /** Ceiling on concurrent Bob runs across every account. */
  concurrencyCap: number;
  /** A run whose cost passes this share of a week is stopped (Phase 4). */
  perRunCostCapPct: number;
  accounts: Record<string, AccountPolicy>;
  tiers: TierPolicy[];
  projectWeights: Record<string, number>;
}

export const DEFAULT_TIERS: TierPolicy[] = [
  { tier: "delivery", enabled: true, maxShare: 1 },
  { tier: "groom", enabled: true, maxShare: 0.4 },
  { tier: "pull-forward", enabled: true, maxShare: 0.3 },
  { tier: "discovery", enabled: true, maxShare: 0.15 },
  { tier: "bizpulse", enabled: true, maxShare: 0.15 },
];

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  enforce: false,
  mode: "run",
  boostFactor: 1.5,
  reservePct: 15,
  shortCeilingPct: 80,
  landingPct: 98,
  landingBufferHours: 2,
  releaseWindowHours: 12,
  paceShape: "even",
  tzOffsetMinutes: -360,
  staleAfterMinutes: 360,
  staleMarginPct: 10,
  unmeteredConcurrency: 1,
  concurrencyCap: 8,
  perRunCostCapPct: 5,
  accounts: {},
  tiers: DEFAULT_TIERS,
  projectWeights: {},
};

export interface MeterReading {
  usedPercent: number;
  resetsAt?: string;
  observedAt: string;
  windowMinutes?: number;
}

export interface GovernorAccountInput {
  accountId: string;
  provider: string;
  status: "ready" | "cooldown" | "disabled" | "error";
  weekly?: MeterReading;
  short?: MeterReading;
  /** Forecast interactive use, in % of the weekly budget per hour. */
  interactivePctPerHour: number;
  /** Typical cost of one Bob run on this account, in % of the weekly budget. */
  costPerRunPct: number;
  /** Typical wall-clock length of a Bob run, in hours. */
  runHours: number;
  activeBobRuns: number;
}

export interface AccountVerdict {
  accountId: string;
  provider: string;
  usedPercent: number;
  hoursToReset: number;
  hoursToRunEnd: number;
  effectiveReservePct: number;
  interactiveForecastPct: number;
  spendablePct: number;
  ratePctPerHour: number;
  targetConcurrent: number;
  activeBobRuns: number;
  slots: number;
  projectedLandingPct: number;
  estimated: boolean;
  reasons: string[];
}

export interface BudgetVerdict {
  at: string;
  mode: BudgetMode;
  enforce: boolean;
  accounts: AccountVerdict[];
  byProvider: Record<string, { slots: number; targetConcurrent: number; active: number }>;
  totalSlots: number;
}

const HOUR_MS = 3_600_000;
const WEEK_MINUTES = 10_080;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const finite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/** Relative pacing weight at a moment, for time-of-week shapes. */
export function paceWeight(shape: PaceShape, at: Date, tzOffsetMinutes: number): number {
  if (shape !== "working-hours") return 1;
  const local = new Date(at.getTime() + tzOffsetMinutes * 60_000);
  const day = local.getUTCDay();
  const hour = local.getUTCHours();
  const weekday = day >= 1 && day <= 5;
  return weekday && hour >= 9 && hour < 18 ? 1.6 : 0.4;
}

/**
 * Multiplier on the even rate right now: weight now ÷ average weight over the
 * remaining horizon, so the whole spendable budget is still spent by run end.
 */
function shapeFactor(policy: BudgetPolicy, now: Date, horizonHours: number): number {
  if (policy.paceShape === "even" || horizonHours <= 0) return 1;
  const weightAt = (hoursAhead: number) => {
    const fraction = hoursAhead / horizonHours;
    if (policy.paceShape === "front-load") return 1.5 - fraction;
    if (policy.paceShape === "back-load") return 0.5 + fraction;
    return paceWeight("working-hours", new Date(now.getTime() + hoursAhead * HOUR_MS), policy.tzOffsetMinutes);
  };
  const samples = Math.max(1, Math.min(168, Math.ceil(horizonHours)));
  let sum = 0;
  for (let i = 0; i < samples; i += 1) sum += weightAt(((i + 0.5) / samples) * horizonHours);
  const average = sum / samples;
  return average > 0 ? weightAt(0) / average : 1;
}

export function effectiveMode(policy: BudgetPolicy, now: Date): BudgetMode {
  if (policy.mode === "run") return "run";
  if (policy.modeUntil) {
    const until = Date.parse(policy.modeUntil);
    if (Number.isFinite(until) && until <= now.getTime()) return "run";
  }
  return policy.mode;
}

function governAccount(input: GovernorAccountInput, policy: BudgetPolicy, mode: BudgetMode, now: Date): AccountVerdict {
  const override = policy.accounts[input.accountId] ?? {};
  const reservePct = override.reservePct ?? policy.reservePct;
  const landingPct = override.landingPct ?? policy.landingPct;
  const shortCeiling = override.shortCeilingPct ?? policy.shortCeilingPct;
  const reasons: string[] = [];
  const active = Math.max(0, Math.floor(input.activeBobRuns));
  const verdict: AccountVerdict = {
    accountId: input.accountId,
    provider: input.provider,
    usedPercent: 0,
    hoursToReset: 0,
    hoursToRunEnd: 0,
    effectiveReservePct: reservePct,
    interactiveForecastPct: 0,
    spendablePct: 0,
    ratePctPerHour: 0,
    targetConcurrent: 0,
    activeBobRuns: active,
    slots: 0,
    projectedLandingPct: 0,
    estimated: false,
    reasons,
  };

  if (override.enabled === false) {
    reasons.push("disabled in policy");
    return verdict;
  }
  if (input.status !== "ready") {
    reasons.push(`account ${input.status}`);
    return verdict;
  }

  // No meter: the governor cannot pace it, so a fixed, small concurrency applies.
  if (!input.weekly) {
    verdict.estimated = true;
    reasons.push("no meter; fixed fallback concurrency");
    if (mode === "pause") {
      reasons.push("paused");
      return verdict;
    }
    verdict.targetConcurrent = Math.max(0, policy.unmeteredConcurrency);
    verdict.slots = Math.max(0, Math.floor(verdict.targetConcurrent) - active);
    return verdict;
  }

  const interactive = Math.max(0, finite(input.interactivePctPerHour));
  let used = clamp(finite(input.weekly.usedPercent), 0, 100);
  const windowMs = (input.weekly.windowMinutes ?? WEEK_MINUTES) * 60_000;
  let resetMs = Date.parse(input.weekly.resetsAt ?? "");
  if (!Number.isFinite(resetMs)) {
    resetMs = now.getTime() + windowMs;
    verdict.estimated = true;
    reasons.push("no reset time; assuming a full window");
  }
  if (resetMs <= now.getTime()) {
    while (resetMs <= now.getTime()) resetMs += windowMs;
    used = 0;
    verdict.estimated = true;
    reasons.push("reset passed since last reading");
  } else {
    const observedMs = Date.parse(input.weekly.observedAt);
    const ageHours = Number.isFinite(observedMs) ? Math.max(0, (now.getTime() - observedMs) / HOUR_MS) : Infinity;
    if (ageHours * 60 > policy.staleAfterMinutes) {
      const padHours = Number.isFinite(ageHours) ? ageHours : 0;
      used = clamp(used + interactive * padHours + policy.staleMarginPct, 0, 100);
      verdict.estimated = true;
      reasons.push(Number.isFinite(ageHours) ? `meter ${Math.round(ageHours)}h old; padded` : "meter time unknown; padded");
    }
  }
  verdict.usedPercent = used;

  const hoursToReset = (resetMs - now.getTime()) / HOUR_MS;
  const hoursToRunEnd = hoursToReset - policy.landingBufferHours;
  verdict.hoursToReset = hoursToReset;
  verdict.hoursToRunEnd = Math.max(0, hoursToRunEnd);

  const release = policy.releaseWindowHours > 0 ? clamp(hoursToRunEnd / policy.releaseWindowHours, 0, 1) : 1;
  verdict.effectiveReservePct = reservePct * release;
  verdict.interactiveForecastPct = interactive * hoursToReset;
  verdict.spendablePct = Math.max(0, landingPct - used - verdict.effectiveReservePct - verdict.interactiveForecastPct);
  verdict.projectedLandingPct = Math.min(100, used + verdict.interactiveForecastPct + verdict.spendablePct);

  if (hoursToRunEnd <= 0) {
    reasons.push("inside the landing buffer");
    return verdict;
  }
  if (verdict.spendablePct <= 0) {
    reasons.push("no spendable budget before reset");
    return verdict;
  }
  if (mode === "pause") {
    reasons.push("paused");
    return verdict;
  }
  if (input.short && Number.isFinite(input.short.usedPercent) && input.short.usedPercent >= shortCeiling) {
    reasons.push(`5h window at ${Math.round(input.short.usedPercent)}% (ceiling ${shortCeiling}%)`);
    return verdict;
  }

  const boost = mode === "boost" ? Math.max(1, policy.boostFactor) : 1;
  verdict.ratePctPerHour = (verdict.spendablePct / hoursToRunEnd) * shapeFactor(policy, now, hoursToRunEnd) * boost;
  const cost = Math.max(0.001, finite(input.costPerRunPct, 1));
  const runHours = Math.max(0.01, finite(input.runHours, 0.5));
  verdict.targetConcurrent = (verdict.ratePctPerHour * runHours) / cost;
  verdict.slots = Math.max(0, Math.floor(verdict.targetConcurrent) - active);
  if (verdict.slots === 0) reasons.push(active > 0 ? "pace met by runs in flight" : "below one run at this pace");
  return verdict;
}

export function governBudget(inputs: readonly GovernorAccountInput[], policy: BudgetPolicy, now: Date): BudgetVerdict {
  const mode = effectiveMode(policy, now);
  const accounts = inputs.map((input) => governAccount(input, policy, mode, now));

  // Respect the global concurrency cap: trim slots from the most generous accounts first.
  const totalActive = accounts.reduce((sum, a) => sum + a.activeBobRuns, 0);
  let room = Math.max(0, Math.floor(policy.concurrencyCap) - totalActive);
  let total = accounts.reduce((sum, a) => sum + a.slots, 0);
  while (total > room) {
    const largest = accounts.reduce((best, a) => (a.slots > best.slots ? a : best));
    largest.slots -= 1;
    if (!largest.reasons.includes("trimmed to the concurrency cap")) largest.reasons.push("trimmed to the concurrency cap");
    total -= 1;
  }
  room = Math.max(0, room);

  const byProvider: BudgetVerdict["byProvider"] = {};
  for (const a of accounts) {
    const entry = (byProvider[a.provider] ??= { slots: 0, targetConcurrent: 0, active: 0 });
    entry.slots += a.slots;
    entry.targetConcurrent += a.targetConcurrent;
    entry.active += a.activeBobRuns;
  }
  return { at: now.toISOString(), mode, enforce: policy.enforce, accounts, byProvider, totalSlots: total };
}

/** Merge a stored (possibly partial or older) policy onto the defaults. */
export function normalizeBudgetPolicy(stored: unknown): BudgetPolicy {
  const raw = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<BudgetPolicy>;
  const num = (value: unknown, fallback: number, lo: number, hi: number) =>
    typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
  const d = DEFAULT_BUDGET_POLICY;
  // Tiers keep the stored order (delivery always first); unknown entries are
  // dropped and missing tiers are appended with their defaults.
  const storedTiers = Array.isArray(raw.tiers) ? raw.tiers.filter((t): t is TierPolicy => typeof t === "object" && t !== null) : [];
  const ordered: BudgetTier[] = ["delivery"];
  for (const t of storedTiers) if (t.tier !== "delivery" && DEFAULT_TIERS.some((def) => def.tier === t.tier) && !ordered.includes(t.tier)) ordered.push(t.tier);
  for (const def of DEFAULT_TIERS) if (!ordered.includes(def.tier)) ordered.push(def.tier);
  const tiers = ordered.map((tier) => {
    const def = DEFAULT_TIERS.find((d0) => d0.tier === tier)!;
    const found = storedTiers.find((t) => t.tier === tier);
    if (!found) return def;
    return {
      tier,
      enabled: tier === "delivery" ? true : found.enabled !== false,
      maxShare: tier === "delivery" ? 1 : num(found.maxShare, def.maxShare, 0, 1),
      ...(typeof found.model === "string" && found.model ? { model: found.model } : {}),
    };
  });
  return {
    enforce: raw.enforce === true,
    mode: raw.mode === "pause" || raw.mode === "boost" ? raw.mode : "run",
    ...(typeof raw.modeUntil === "string" && Number.isFinite(Date.parse(raw.modeUntil)) ? { modeUntil: raw.modeUntil } : {}),
    boostFactor: num(raw.boostFactor, d.boostFactor, 1, 4),
    reservePct: num(raw.reservePct, d.reservePct, 0, 60),
    shortCeilingPct: num(raw.shortCeilingPct, d.shortCeilingPct, 10, 100),
    landingPct: num(raw.landingPct, d.landingPct, 10, 100),
    landingBufferHours: num(raw.landingBufferHours, d.landingBufferHours, 0, 24),
    releaseWindowHours: num(raw.releaseWindowHours, d.releaseWindowHours, 0, 72),
    paceShape: raw.paceShape === "working-hours" || raw.paceShape === "front-load" || raw.paceShape === "back-load" ? raw.paceShape : "even",
    tzOffsetMinutes: num(raw.tzOffsetMinutes, d.tzOffsetMinutes, -720, 840),
    staleAfterMinutes: num(raw.staleAfterMinutes, d.staleAfterMinutes, 15, 1440),
    staleMarginPct: num(raw.staleMarginPct, d.staleMarginPct, 0, 50),
    unmeteredConcurrency: num(raw.unmeteredConcurrency, d.unmeteredConcurrency, 0, 10),
    concurrencyCap: num(raw.concurrencyCap, d.concurrencyCap, 0, 64),
    perRunCostCapPct: num(raw.perRunCostCapPct, d.perRunCostCapPct, 0.1, 50),
    accounts: typeof raw.accounts === "object" && raw.accounts !== null ? raw.accounts : {},
    tiers,
    projectWeights: typeof raw.projectWeights === "object" && raw.projectWeights !== null ? raw.projectWeights : {},
  };
}

/**
 * Split a tick's run slots down the surplus ladder (BOB-76 Phase 5).
 * Delivery takes what its queue can use; whatever is left flows through the
 * enabled tiers in order, each capped by its share of that leftover and by
 * how much work it actually has. Anything still unallocated lapses.
 */
export function allocateSurplus(
  totalSlots: number,
  demand: Partial<Record<BudgetTier, number>>,
  tiers: readonly TierPolicy[],
): Record<BudgetTier, number> {
  const out: Record<BudgetTier, number> = { delivery: 0, groom: 0, "pull-forward": 0, discovery: 0, bizpulse: 0 };
  const total = Math.max(0, Math.floor(totalSlots));
  out.delivery = Math.min(total, Math.max(0, Math.floor(demand.delivery ?? 0)));
  const surplus = total - out.delivery;
  let remaining = surplus;
  for (const tier of tiers) {
    if (tier.tier === "delivery" || !tier.enabled || remaining <= 0 || tier.maxShare <= 0) continue;
    const cap = Math.max(1, Math.floor(surplus * tier.maxShare));
    const n = Math.min(cap, Math.max(0, Math.floor(demand[tier.tier] ?? 0)), remaining);
    out[tier.tier] = n;
    remaining -= n;
  }
  return out;
}
