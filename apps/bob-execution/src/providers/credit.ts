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

export type RunFailureKind = "no_credit" | "auth" | "other";

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
];

/**
 * Transient throttling. Checked BEFORE credit patterns: a 429 is not an
 * exhausted balance, and latching one would strand a healthy agent behind a
 * "Top up" button that fixes nothing.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [/\b429\b/, /rate ?limit/i, /too many requests/i];

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
  if (matches(RATE_LIMIT_PATTERNS, text)) return "other";
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

export class CreditLatch {
  private readonly state = new Map<ProviderId, { detail: string; at: string }>();

  /**
   * `store` makes the latch durable and cross-process. Omit it for pure unit
   * work; the daemon and the runner both pass a FileCreditStore pointed at the
   * same path so they cannot disagree about a provider.
   */
  constructor(private readonly store?: CreditStore) {
    // The state file is operator-editable and may predate a schema change, so
    // validate the shape rather than trusting the declared type.
    const stored: unknown = this.store?.read() ?? {};
    for (const [provider, value] of Object.entries(stored as Record<string, unknown>)) {
      const record = value as { detail?: unknown; at?: unknown } | null;
      if (record && typeof record.detail === "string") {
        this.state.set(provider as ProviderId, {
          detail: record.detail,
          at: typeof record.at === "string" ? record.at : "",
        });
      }
    }
  }

  private persist(): void {
    this.store?.write(Object.fromEntries(this.state));
  }

  /**
   * Feed every dispatch outcome through here. A credit failure latches; a
   * success clears; anything else leaves the latch untouched (a network blip
   * while broke must not look like recovery).
   */
  noteRunOutcome(provider: ProviderId, outcome: RunOutcome, now = new Date()): void {
    if (outcome.code === 0) {
      if (this.state.delete(provider)) this.persist();
      return;
    }
    if (classifyRunFailure(outcome) !== "no_credit") return;
    this.state.set(provider, {
      detail: redactDetail(`${outcome.stderr ?? ""}\n${outcome.stdout ?? ""}`),
      at: now.toISOString(),
    });
    this.persist();
  }

  /**
   * Re-authentication explicitly does NOT clear the latch. Kept as a named
   * no-op so the auth path reads as a deliberate decision rather than an
   * omission someone later "fixes".
   */
  noteAuthSuccess(_provider: ProviderId): void {
    // Intentionally empty. See module docblock.
  }

  isLatched(provider: ProviderId): boolean {
    return this.state.has(provider);
  }

  detail(provider: ProviderId): string | undefined {
    return this.state.get(provider)?.detail;
  }

  get(provider: ProviderId): CreditState {
    const entry = this.state.get(provider);
    return entry ? { latched: true, detail: entry.detail } : { latched: false };
  }

  clear(provider: ProviderId): void {
    if (this.state.delete(provider)) this.persist();
  }

  /** When the latch was set, for "unable to dispatch since …" in the UI. */
  latchedAt(provider: ProviderId): string | undefined {
    return this.state.get(provider)?.at;
  }
}
