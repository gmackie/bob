/**
 * Token ledger from CLIProxyAPI's usage queue (BOB-76).
 *
 * The proxy publishes one record per upstream request on
 * `/v0/management/usage-queue`, popped destructively and kept only briefly, so
 * the runner host drains it often and keeps the result here. Each record names
 * the serving account (`auth_index`), provider, model, the client's proxy API
 * key, the agent session and the full token breakdown.
 *
 * Attribution is exact: requests made with one of this host's own proxy keys
 * are Bob's; everything else is interactive. The raw key is compared here and
 * never stored. Nothing that identifies a person or a client — keys, addresses,
 * user agents, interactive session ids, response headers — leaves this module.
 *
 * Output is cumulative and idempotent. Hourly buckets and Bob session totals
 * are absolute values with a revision number, so the server can upsert
 * whatever it receives, any number of times, and a lost message is repaired by
 * the next one.
 */

import {
  parseQuotaMeters,
  type BobSessionUsageWire,
  type BudgetSessionLinkWire,
  type BudgetMeterWire,
  type LedgerTokens,
  type UsageBucketWire,
  type UsageSource,
} from "@bob/ws";

export type { BobSessionUsageWire, BudgetSessionLinkWire, LedgerTokens, UsageBucketWire, UsageSource };

/** The fields of a usage-queue record this ledger reads. */
export interface UsageQueueRecord {
  timestamp?: string;
  provider?: string;
  model?: string;
  auth_index?: string;
  auth_type?: string;
  api_key?: string;
  session_id?: string;
  failed?: boolean;
  tokens?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    total_tokens?: number;
  };
  response_headers?: Record<string, string[] | string> | null;
  [other: string]: unknown;
}

export interface UsageLedgerOptions {
  /** This host's proxy API keys. Held in memory only; never serialized. */
  bobApiKeys: readonly string[];
  /** How long buckets and sessions are kept after their last update. Default 48h. */
  retentionHours?: number;
}

interface Stamped<T> {
  value: T;
  rev: number;
}

export interface UsageLedgerState {
  rev: number;
  buckets: Array<Stamped<UsageBucketWire>>;
  sessions: Array<Stamped<BobSessionUsageWire>>;
  links?: Array<Stamped<BudgetSessionLinkWire>>;
}

const PROVIDER_ALIASES: Record<string, string> = { anthropic: "claude", openai: "codex", xai: "grok" };
const HOUR_MS = 3_600_000;

function parseTime(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\.(\d+)/, (_, digits: string) => `.${`${digits}000`.slice(0, 3)}`);
  const at = Date.parse(normalized);
  return Number.isFinite(at) ? new Date(at) : undefined;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

function tokensOf(record: UsageQueueRecord): LedgerTokens {
  const t = record.tokens ?? {};
  return {
    input: count(t.input_tokens),
    output: count(t.output_tokens),
    reasoning: count(t.reasoning_tokens),
    cacheRead: count(t.cache_read_tokens ?? t.cached_tokens),
    cacheCreation: count(t.cache_creation_tokens),
    total: count(t.total_tokens),
  };
}

function addTokens(into: LedgerTokens, add: LedgerTokens): void {
  into.input += add.input;
  into.output += add.output;
  into.reasoning += add.reasoning;
  into.cacheRead += add.cacheRead;
  into.cacheCreation += add.cacheCreation;
  into.total += add.total;
}

const zeroTokens = (): LedgerTokens => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheCreation: 0, total: 0 });

function metersFromHeaders(provider: string, headers: UsageQueueRecord["response_headers"], at: Date): BudgetMeterWire[] {
  if (!headers) return [];
  const signals: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") signals[name] = first;
  }
  return parseQuotaMeters(provider, { observed_at: at.toISOString(), signals });
}

export class UsageLedger {
  private readonly bobKeys: ReadonlySet<string>;
  private readonly retentionMs: number;
  private rev = 0;
  private readonly bucketMap = new Map<string, Stamped<UsageBucketWire>>();
  private readonly sessionMap = new Map<string, Stamped<BobSessionUsageWire>>();
  private readonly linkMap = new Map<string, Stamped<BudgetSessionLinkWire>>();

  constructor(options: UsageLedgerOptions) {
    this.bobKeys = new Set(options.bobApiKeys.filter((key) => key.length > 0));
    this.retentionMs = (options.retentionHours ?? 48) * HOUR_MS;
  }

  static restore(options: UsageLedgerOptions, state: UsageLedgerState): UsageLedger {
    const ledger = new UsageLedger(options);
    ledger.rev = Number.isSafeInteger(state?.rev) ? state.rev : 0;
    for (const entry of state?.buckets ?? []) {
      const b = entry.value;
      ledger.bucketMap.set(UsageLedger.bucketKey(b.hour, b.authIndex, b.model, b.source), entry);
    }
    for (const entry of state?.sessions ?? []) ledger.sessionMap.set(entry.value.sessionId, entry);
    for (const entry of state?.links ?? []) ledger.linkMap.set(entry.value.nativeSessionId, entry);
    return ledger;
  }

  private static bucketKey(hour: string, authIndex: string, model: string, source: UsageSource): string {
    return `${hour}\u0000${authIndex}\u0000${model}\u0000${source}`;
  }

  /** Fold a batch of queue records. Malformed records are skipped, never fatal. */
  ingest(records: readonly UsageQueueRecord[]): void {
    for (const record of records ?? []) {
      try {
        this.ingestOne(record);
      } catch {
        // skip
      }
    }
  }

  private ingestOne(record: UsageQueueRecord): void {
    const at = parseTime(record.timestamp);
    const authIndex = typeof record.auth_index === "string" ? record.auth_index : "";
    const rawProvider = typeof record.provider === "string" ? record.provider.toLowerCase() : "";
    if (!at || !authIndex || !rawProvider) return;
    const provider = PROVIDER_ALIASES[rawProvider] ?? rawProvider;
    const model = typeof record.model === "string" && record.model ? record.model : "unknown";
    const source: UsageSource = typeof record.api_key === "string" && this.bobKeys.has(record.api_key) ? "bob" : "interactive";
    const tokens = tokensOf(record);
    const failed = record.failed === true ? 1 : 0;
    const rev = ++this.rev;

    const hour = new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS).toISOString();
    const key = UsageLedger.bucketKey(hour, authIndex, model, source);
    const bucket = this.bucketMap.get(key) ?? {
      rev,
      value: { hour, authIndex, provider, model, source, requests: 0, failed: 0, tokens: zeroTokens() },
    };
    bucket.rev = rev;
    bucket.value.requests += 1;
    bucket.value.failed += failed;
    addTokens(bucket.value.tokens, tokens);
    this.bucketMap.set(key, bucket);

    const sessionId = typeof record.session_id === "string" ? record.session_id : "";
    if (source !== "bob" || !sessionId) return;
    const meters = metersFromHeaders(provider, record.response_headers, at);
    const existing = this.sessionMap.get(sessionId);
    if (!existing) {
      this.sessionMap.set(sessionId, {
        rev,
        value: {
          sessionId,
          authIndex,
          provider,
          model,
          requests: 1,
          failed,
          tokens,
          firstAt: at.toISOString(),
          lastAt: at.toISOString(),
          ...(meters.length ? { metersFirst: meters, metersLast: meters } : {}),
        },
      });
      return;
    }
    const session = existing.value;
    existing.rev = rev;
    session.requests += 1;
    session.failed += failed;
    addTokens(session.tokens, tokens);
    if (at.toISOString() < session.firstAt) {
      session.firstAt = at.toISOString();
      if (meters.length) session.metersFirst = meters;
    }
    if (at.toISOString() >= session.lastAt) {
      session.lastAt = at.toISOString();
      if (meters.length) session.metersLast = meters;
    }
    if (meters.length && !session.metersFirst) session.metersFirst = meters;
  }

  /** Record which Bob run an agent CLI session belongs to. */
  linkSession(nativeSessionId: string, bobSessionId: string, at = new Date()): void {
    if (!nativeSessionId || !bobSessionId || this.linkMap.get(nativeSessionId)?.value.bobSessionId === bobSessionId) return;
    this.linkMap.set(nativeSessionId, { rev: ++this.rev, value: { nativeSessionId, bobSessionId, linkedAt: at.toISOString() } });
  }

  links({ since = 0 }: { since?: number } = {}): BudgetSessionLinkWire[] {
    return [...this.linkMap.values()].filter((entry) => entry.rev > since).map((entry) => entry.value);
  }

  /** Current revision; pass it back as `since` to get only later changes. */
  revision(): number {
    return this.rev;
  }

  buckets({ since = 0 }: { since?: number } = {}): UsageBucketWire[] {
    return [...this.bucketMap.values()]
      .filter((entry) => entry.rev > since)
      .map((entry) => entry.value)
      .sort((a, b) => a.hour.localeCompare(b.hour) || a.authIndex.localeCompare(b.authIndex) || a.model.localeCompare(b.model) || a.source.localeCompare(b.source));
  }

  sessions({ since = 0 }: { since?: number } = {}): BobSessionUsageWire[] {
    return [...this.sessionMap.values()]
      .filter((entry) => entry.rev > since)
      .map((entry) => entry.value)
      .sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  }

  /** Forget buckets whose hour, and sessions whose last request, fall outside the retention window. */
  prune(now = new Date()): void {
    const cutoff = now.getTime() - this.retentionMs;
    for (const [key, entry] of this.bucketMap) {
      if (Date.parse(entry.value.hour) + HOUR_MS <= cutoff) this.bucketMap.delete(key);
    }
    for (const [key, entry] of this.sessionMap) {
      if (Date.parse(entry.value.lastAt) <= cutoff) this.sessionMap.delete(key);
    }
    for (const [key, entry] of this.linkMap) {
      if (Date.parse(entry.value.linkedAt) <= cutoff) this.linkMap.delete(key);
    }
  }

  /** Serializable state for the on-disk spool. Holds no keys. */
  toJSON(): UsageLedgerState {
    return { rev: this.rev, buckets: [...this.bucketMap.values()], sessions: [...this.sessionMap.values()], links: [...this.linkMap.values()] };
  }
}
