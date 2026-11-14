/**
 * Subscription budget meters from CLIProxyAPI's captured rate-limit headers.
 *
 * The proxy records, per account (`quota`) and per model (`model_quotas`), the
 * rate-limit headers of the latest upstream response together with the time it
 * saw them. Those headers are the providers' own utilization meters:
 *
 * - Claude: `anthropic-ratelimit-unified-<window>-utilization` (a 0–1
 *   fraction), `-reset` (epoch seconds) and `-status`.
 * - Codex: `x-codex-<primary|secondary>-used-percent` (0–100),
 *   `-window-minutes`, `-reset-at` (epoch seconds) or `-reset-after-seconds`.
 *
 * Meters are passive: they refresh only when the account serves traffic, so
 * every reading carries `observedAt` and the consumer decides how stale is too
 * stale. Parsing fails closed — a value that cannot be read yields no meter
 * rather than a guess — so the budget governor falls back to its ledger
 * estimate instead of acting on a wrong number.
 *
 * Shared by the runner (which folds it into the heartbeat) and the UI (which
 * renders it). BOB-76.
 */

/** `quota` / `model_quotas[model]` as the management API returns them. */
export interface ManagementQuota {
  observed_at?: string;
  signals?: Record<string, string> | null;
}

export interface BudgetMeterWire {
  /** `weekly`, `5h`, or `<minutes>m` for a window length Bob has no name for. */
  window: string;
  windowMinutes?: number;
  /** 0–100. */
  usedPercent: number;
  resetsAt?: string;
  /** The provider's own verdict where it sends one (Claude: allowed, allowed_warning, rejected). */
  status?: string;
  /** When the proxy saw these headers; the reading is only as fresh as this. */
  observedAt: string;
}

const WINDOW_NAMES: Record<number, string> = { 10_080: "weekly", 300: "5h" };
const CLAUDE_WINDOW_MINUTES: Record<string, number> = { "7d": 10_080, "5h": 300 };

function windowName(minutes: number | undefined, fallback: string): string {
  if (minutes === undefined) return fallback;
  return WINDOW_NAMES[minutes] ?? `${minutes}m`;
}

/**
 * ISO time from the proxy's Go timestamps, which carry nanoseconds; trimming the
 * fraction to milliseconds keeps parsing independent of the JS engine.
 */
function parseObservedAt(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/(\.\d{3})\d+/, "$1");
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? new Date(at) : undefined;
}

function finite(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function epochSeconds(value: string | undefined): string | undefined {
  const seconds = finite(value);
  return seconds !== undefined && seconds > 0 ? new Date(seconds * 1_000).toISOString() : undefined;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/** Header names are case-insensitive; the proxy keeps the upstream casing. */
function lowerKeys(signals: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(signals)) {
    if (typeof value === "string") map.set(key.toLowerCase(), value);
  }
  return map;
}

function claudeMeters(signals: Map<string, string>, observedAt: Date): BudgetMeterWire[] {
  const prefix = "anthropic-ratelimit-unified-";
  const meters: BudgetMeterWire[] = [];
  for (const [key, raw] of signals) {
    const match = key.startsWith(prefix) ? /^([a-z0-9_]+)-utilization$/.exec(key.slice(prefix.length)) : null;
    if (!match) continue;
    const label = match[1]!;
    const fraction = finite(raw);
    if (fraction === undefined) continue;
    const windowMinutes = CLAUDE_WINDOW_MINUTES[label];
    const resetsAt = epochSeconds(signals.get(`${prefix}${label}-reset`));
    const status = signals.get(`${prefix}${label}-status`)?.trim();
    meters.push({
      window: windowName(windowMinutes, label),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      usedPercent: clampPercent(Math.round(fraction * 10_000) / 100),
      ...(resetsAt ? { resetsAt } : {}),
      ...(status ? { status } : {}),
      observedAt: observedAt.toISOString(),
    });
  }
  return meters;
}

function codexMeters(signals: Map<string, string>, observedAt: Date): BudgetMeterWire[] {
  const meters: BudgetMeterWire[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const prefix = `x-codex-${slot}-`;
    const used = finite(signals.get(`${prefix}used-percent`));
    if (used === undefined) continue;
    const minutes = finite(signals.get(`${prefix}window-minutes`));
    // A zero-length window is how Codex says "this window is not in force".
    if (minutes === 0) continue;
    const windowMinutes = minutes !== undefined && minutes > 0 ? Math.round(minutes) : undefined;
    let resetsAt = epochSeconds(signals.get(`${prefix}reset-at`));
    const after = finite(signals.get(`${prefix}reset-after-seconds`));
    if (!resetsAt && after !== undefined && after > 0) {
      resetsAt = new Date(observedAt.getTime() + after * 1_000).toISOString();
    }
    meters.push({
      window: windowName(windowMinutes, slot),
      ...(windowMinutes !== undefined ? { windowMinutes } : {}),
      usedPercent: clampPercent(used),
      ...(resetsAt ? { resetsAt } : {}),
      observedAt: observedAt.toISOString(),
    });
  }
  return meters;
}

/**
 * Meters for one account or model. `provider` is Bob's provider id (claude,
 * codex, grok, kimi, …); providers whose headers the proxy does not capture
 * return no meters.
 */
export function parseQuotaMeters(provider: string, quota: ManagementQuota | null | undefined): BudgetMeterWire[] {
  if (!quota?.signals) return [];
  const observedAt = parseObservedAt(quota.observed_at);
  if (!observedAt) return [];
  const signals = lowerKeys(quota.signals);
  if (provider === "claude") return claudeMeters(signals, observedAt);
  if (provider === "codex") return codexMeters(signals, observedAt);
  return [];
}

// ---------------------------------------------------------------------------
// Token ledger wire (runner → gateway), produced by the runner's UsageLedger.
// ---------------------------------------------------------------------------

export type UsageSource = "bob" | "interactive";

export interface LedgerTokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

/** Running totals for one UTC hour × serving account × model × source. */
export interface UsageBucketWire {
  /** Start of the UTC hour. */
  hour: string;
  authIndex: string;
  provider: string;
  model: string;
  source: UsageSource;
  requests: number;
  failed: number;
  tokens: LedgerTokens;
}

/** Running totals for one Bob agent session (the proxy's session id). */
export interface BobSessionUsageWire {
  sessionId: string;
  authIndex: string;
  provider: string;
  model: string;
  requests: number;
  failed: number;
  tokens: LedgerTokens;
  firstAt: string;
  lastAt: string;
  /** Meters on the session's first and latest request: their difference is what it cost. */
  metersFirst?: BudgetMeterWire[];
  metersLast?: BudgetMeterWire[];
}
