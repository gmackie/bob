/**
 * Credit state for CLI providers.
 *
 * No probe can see an exhausted balance. On 2026-08-29 `grok models` exited 0
 * with valid credentials and a dead account, so the health check reported the
 * agent ready while every dispatch died on `402 Payment Required — Grok Build
 * usage balance exhausted`. The runner burned the whole backlog for eight days.
 *
 * Balance is not an auth fact, so it cannot be probed — the only thing that
 * ever knows is the exit of a real run. This module classifies run failures and
 * latches the credit verdict until a subsequent run actually succeeds.
 *
 * The latch is deliberately NOT cleared by a successful re-authentication:
 * signing in again does not buy credit, and clearing it there is what makes the
 * UI say "sign in" when it should say "top up".
 */

import type { ProviderId } from "./contract.js";
import type { CreditStore } from "./credit-store.js";

/**
 * How a failed run disqualifies an agent. The kinds are separate because the
 * REMEDIES are separate: top up, sign in, or wait. Collapsing them sends the
 * operator at the wrong one.
 */
export type RunFailureKind = "no_credit" | "auth" | "rate_limited" | "other";

/**
 * Credit/billing exhaustion. Ordered most- to least-specific; `payment
 * required` and `402` are the canonical forms, the rest cover provider wording
 * we have actually seen in the wild.
 */
const CREDIT_PATTERNS: RegExp[] = [
  /\b402\b/,
  /payment required/i,
  /balance (is )?(too low|exhausted)/i,
  /usage balance/i,
  /credit balance/i,
  /out of credits?/i,
  /insufficient[_ ]?(quota|credit|funds|balance)/i,
  /exceeded your current quota/i,
  /quota exceeded/i,
  /billing/i,
];

/**
 * Authentication failure. Handled by the probe rather than the latch — listed
 * here so callers can tell "sign in" from "top up" from a run outcome alone.
 */
const AUTH_PATTERNS: RegExp[] = [
  /\b401\b/,
  /unauthorized/i,
  /unauthenticated/i,
  /token (revoked|expired)/i,
  /session expired/i,
  /re-?login/i,
  /not logged in/i,
  /please (log|sign) ?in/i,
  /oauth/i,
  // The exact strings observed on 2026-08-30.
  /authentication required/i,
  /please run '[^']*login'/i,
  /set [A-Z_]*API_KEY/,
];

/**
 * Throttling. Checked BEFORE credit patterns: a 429 is not an exhausted
 * balance, and latching one as credit would strand a healthy agent behind a
 * "Top up" button that fixes nothing. It IS reported, though — claude's weekly
 * cap ("You've hit your weekly limit · resets 3pm (UTC)") blocks dispatch just
 * as hard as a dead credential, and showing "Ready" through it is what left
 * 20 runs failing against agents the page called healthy.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /\b429\b/,
  /rate[ _]?limit/i,
  /too many requests/i,
  /weekly limit/i,
  /usage limit reached/i,
];

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export interface RunOutcome {
  code: number;
  stdout?: string;
  stderr?: string;
}

export function classifyRunFailure(outcome: RunOutcome): RunFailureKind {
  if (outcome.code === 0) return "other";
  const text = `${outcome.stderr ?? ""}\n${outcome.stdout ?? ""}`;
  if (matches(RATE_LIMIT_PATTERNS, text)) return "rate_limited";
  if (matches(CREDIT_PATTERNS, text)) return "no_credit";
  if (matches(AUTH_PATTERNS, text)) return "auth";
  return "other";
}

const MAX_DETAIL = 300;

/**
 * Token-shaped runs of characters. Provider errors quote request context and
 * occasionally echo a key; the detail string is rendered in the UI, so scrub
 * before it ever leaves the daemon.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
  // Account identifiers. Never needed to decide "sign in" vs "top up", and
  // provider auth output quotes them freely.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

/**
 * Reduce provider output to a single safe line for the UI. The provider's own
 * wording is the point — the 402 body named the exact problem — so redact
 * secrets and truncate, but never paraphrase.
 */
export function redactDetail(raw: string): string {
  let text = raw;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[redacted]");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text;
}

export interface CreditState {
  latched: boolean;
  detail?: string;
}

/** What a run outcome most recently proved about a provider. */
export interface LatchedOutcome {
  /** Undefined means nothing is latched — the probe's verdict stands. */
  kind?: Exclude<RunFailureKind, "other">;
  detail?: string;
  at?: string;
}

/**
 * What real runs have proved about each provider, on top of what the probe can
 * see. A probe cannot detect an exhausted balance, a revoked token that still
 * has a local session file, or a weekly cap — only an actual run reveals those.
 */
export class RunOutcomeLatch {
  private readonly state = new Map<ProviderId, Required<LatchedOutcome>>();

  /**
   * `store` makes the latch durable and cross-process. Omit it for pure unit
   * work; the daemon, the runner and the health CLI all pass a FileCreditStore
   * pointed at the same path so they cannot disagree about a provider.
   */
  constructor(private readonly store?: CreditStore) {
    // The state file is operator-editable and may predate a schema change, so
    // validate the shape rather than trusting the declared type. Entries
    // written before kinds existed recorded only credit failures.
    const stored: unknown = this.store?.read() ?? {};
    for (const [provider, value] of Object.entries(stored as Record<string, unknown>)) {
      const record = value as { detail?: unknown; at?: unknown; kind?: unknown } | null;
      if (!record || typeof record.detail !== "string") continue;
      const kind =
        record.kind === "auth" || record.kind === "rate_limited" || record.kind === "no_credit"
          ? record.kind
          : "no_credit";
      this.state.set(provider as ProviderId, {
        kind,
        detail: record.detail,
        at: typeof record.at === "string" ? record.at : "",
      });
    }
  }

  private persist(): void {
    this.store?.write(Object.fromEntries(this.state));
  }

  /**
   * Feed every dispatch outcome through here. A success clears the latch; a
   * recognised failure records WHICH kind, so the UI can offer the matching
   * remedy. Anything unrecognised leaves the latch untouched — a network blip
   * must not be reported as a credential problem.
   */
  noteRunOutcome(provider: ProviderId, outcome: RunOutcome, now = new Date()): void {
    if (outcome.code === 0) {
      if (this.state.delete(provider)) this.persist();
      return;
    }
    const kind = classifyRunFailure(outcome);
    if (kind === "other") return;
    this.state.set(provider, {
      kind,
      detail: redactDetail(`${outcome.stderr ?? ""}\n${outcome.stdout ?? ""}`),
      at: now.toISOString(),
    });
    this.persist();
  }

  /**
   * Signing in clears an AUTH latch — that is exactly the remedy for one. It
   * deliberately does NOT clear credit or a rate limit: re-authenticating buys
   * no credit and resets no quota, and clearing there is what made the UI say
   * "sign in" when it should have said "top up".
   */
  noteAuthSuccess(provider: ProviderId): void {
    if (this.state.get(provider)?.kind === "auth" && this.state.delete(provider)) {
      this.persist();
    }
  }

  get(provider: ProviderId): LatchedOutcome {
    const entry = this.state.get(provider);
    return entry ? { kind: entry.kind, detail: entry.detail, at: entry.at } : {};
  }

  isLatched(provider: ProviderId): boolean {
    return this.state.has(provider);
  }

  detail(provider: ProviderId): string | undefined {
    return this.state.get(provider)?.detail;
  }

  clear(provider: ProviderId): void {
    if (this.state.delete(provider)) this.persist();
  }

  /** When the latch was set, for "unable to dispatch since …" in the UI. */
  latchedAt(provider: ProviderId): string | undefined {
    return this.state.get(provider)?.at;
  }
}

/** @deprecated Name kept so existing imports keep working. */
export const CreditLatch = RunOutcomeLatch;
