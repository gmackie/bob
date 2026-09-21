/**
 * Inference-proxy telemetry: fold CLIProxyAPI's management responses into the
 * redacted wire shapes that ride inside the host snapshot heartbeat.
 *
 * The proxy holds the subscription accounts that serve production inference.
 * Its management API reports per-account state (active / error / disabled,
 * cooldowns with a retry time, recent request buckets). This module turns that
 * into `ProxyAccountWire` rows and derives the per-provider status the
 * existing agent lights already understand, so a provider with every account
 * cooling down reads as rate-limited and one with no serviceable account reads
 * as sign-in-required — the same remedies, now from the right source.
 *
 * Shared by the runner (which polls) and the UI (which renders), so the two
 * cannot disagree about what a cooldown means.
 */

import type { ProviderHealthWire, ProxyAccountWire, ProxyUsageWire } from "./protocol";

/** The subset of a management `auth-files` entry that Bob reads. */
export interface ManagementAuthFile {
  id?: string;
  name?: string;
  auth_index?: string;
  provider?: string;
  type?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
  email?: string;
  label?: string;
  success?: number;
  failed?: number;
  last_refresh?: string;
  cooldowns?: Array<{
    scope?: string;
    reason?: string;
    retry_at?: string;
    remaining_seconds?: number;
  }> | null;
  recent_requests?: Array<{ time?: string; success?: number; failed?: number }> | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The proxy's provider names → Bob's provider ids. Unknown names pass through. */
const PROVIDER_ALIASES: Record<string, ProxyAccountWire["provider"]> = {
  claude: "claude",
  anthropic: "claude",
  codex: "codex",
  openai: "codex",
  xai: "grok",
  grok: "grok",
  kimi: "kimi",
  gemini: "gemini",
};

/**
 * First character plus the domain: enough to tell two accounts apart in a
 * list, not enough to reconstruct the address. The raw email never reaches
 * the wire.
 */
export function maskAccountLabel(email: string | undefined, fallback = "account"): string {
  const text = email?.trim() ?? "";
  const at = text.indexOf("@");
  if (at <= 0) return fallback;
  return `${text[0]}…@${text.slice(at + 1)}`;
}

function toMillis(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function sumRecent(
  buckets: ManagementAuthFile["recent_requests"],
  now: Date,
): { success: number; failed: number } {
  const cutoff = now.getTime() - DAY_MS;
  let success = 0;
  let failed = 0;
  for (const bucket of buckets ?? []) {
    const at = toMillis(bucket?.time);
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime()) continue;
    success += Number(bucket?.success ?? 0) || 0;
    failed += Number(bucket?.failed ?? 0) || 0;
  }
  return { success, failed };
}

function activeCooldown(
  cooldowns: ManagementAuthFile["cooldowns"],
  now: Date,
): { retryAt: string; reason?: string } | undefined {
  let latest: { retryAt: string; reason?: string; at: number } | undefined;
  for (const cooldown of cooldowns ?? []) {
    const at = toMillis(cooldown?.retry_at);
    if (!Number.isFinite(at) || at <= now.getTime()) continue;
    if (!latest || at > latest.at) {
      latest = { retryAt: new Date(at).toISOString(), reason: cooldown?.reason || undefined, at };
    }
  }
  return latest ? { retryAt: latest.retryAt, reason: latest.reason } : undefined;
}

function foldOne(entry: ManagementAuthFile, now: Date): ProxyAccountWire | undefined {
  const id = typeof entry.id === "string" && entry.id ? entry.id : entry.name;
  if (!id) return undefined;
  const rawProvider = (entry.provider || entry.type || "").toLowerCase();
  if (!rawProvider) return undefined;
  const provider = PROVIDER_ALIASES[rawProvider] ?? (rawProvider as ProxyAccountWire["provider"]);

  const cooldown = activeCooldown(entry.cooldowns, now);
  let status: ProxyAccountWire["status"];
  let detail: string | undefined;
  if (entry.disabled === true || entry.status === "disabled") {
    status = "disabled";
  } else if (entry.unavailable === true || entry.status === "error" || entry.status === "expired") {
    status = "error";
    detail = entry.status_message?.trim() || undefined;
  } else if (cooldown) {
    status = "cooldown";
  } else {
    status = "ready";
  }

  const lastRefresh = toMillis(entry.last_refresh);
  return {
    id,
    provider,
    label: maskAccountLabel(entry.email, entry.label?.trim() || id),
    status,
    ...(cooldown ? { cooldownUntil: cooldown.retryAt, ...(cooldown.reason ? { cooldownReason: cooldown.reason } : {}) } : {}),
    ...(detail ? { detail } : {}),
    ...(Number.isFinite(lastRefresh) ? { lastRefreshAt: new Date(lastRefresh).toISOString() } : {}),
    requests24h: sumRecent(entry.recent_requests, now),
    ...(entry.name || entry.auth_index
      ? { ref: { ...(entry.name ? { name: entry.name } : {}), ...(entry.auth_index ? { authIndex: entry.auth_index } : {}) } }
      : {}),
  };
}

/** One malformed entry must not blank the whole panel; it is skipped. */
export function foldProxyAccounts(entries: ManagementAuthFile[], now = new Date()): ProxyAccountWire[] {
  const folded: ProxyAccountWire[] = [];
  for (const entry of entries ?? []) {
    try {
      const account = foldOne(entry, now);
      if (account) folded.push(account);
    } catch {
      // skip
    }
  }
  return folded;
}

/**
 * The provider-level status the agent lights render, from the proxy's account
 * states. Any ready account → ready. Every account cooling → rate_limited
 * (temporary; wait). Nothing serviceable → unauthenticated (sign in on the
 * proxy). Only the provider asked about is considered.
 */
export function deriveProviderStatusFromProxy(
  provider: string,
  accounts: readonly ProxyAccountWire[],
): ProviderHealthWire["status"] {
  const mine = accounts.filter((account) => account.provider === provider);
  if (mine.some((account) => account.status === "ready")) return "ready";
  if (mine.length > 0 && mine.every((account) => account.status === "cooldown")) return "rate_limited";
  return "unauthenticated";
}

export function summarizeProxyUsage(accounts: readonly ProxyAccountWire[]): ProxyUsageWire {
  const total = { success: 0, failed: 0 };
  const byProvider: ProxyUsageWire["byProvider"] = {};
  for (const account of accounts) {
    total.success += account.requests24h.success;
    total.failed += account.requests24h.failed;
    const bucket = (byProvider[account.provider] ??= { success: 0, failed: 0 });
    bucket.success += account.requests24h.success;
    bucket.failed += account.requests24h.failed;
  }
  return { total, byProvider };
}
