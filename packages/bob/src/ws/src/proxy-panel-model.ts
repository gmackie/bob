/**
 * The inference proxy, as a person reads it: one view-model for the web Nodes
 * page and the phone, so a cooldown looks the same on both and the alert
 * threshold ("no ready account for this provider") is decided once.
 *
 * Everything here is derived from the host snapshot heartbeat; no extra RPC.
 * Tones follow the agent lights: green is fine, amber is something a person
 * can act on, red is broken, grey is nothing to act on (disabled, or the host
 * has gone quiet and the snapshot cannot be trusted).
 */

import type { HostSnapshotWire, ProxyAccountWire } from "./protocol";

export type ProxyTone = "green" | "amber" | "red" | "grey";

export interface ProxyPanelAccount {
  id: string;
  provider: string;
  providerLabel: string;
  label: string;
  status: ProxyAccountWire["status"];
  statusLabel: string;
  tone: ProxyTone;
  /** "lifts in 1h 59m" while cooling down. */
  cooldownLabel?: string;
  requestsLabel: string;
  detail?: string;
  canEnable: boolean;
  canDisable: boolean;
  canRefresh: boolean;
}

export interface ProxyPanelProvider {
  provider: string;
  label: string;
  ready: number;
  cooling: number;
  errored: number;
  disabled: number;
  /** "1 ready · 1 cooling down" */
  summary: string;
  tone: ProxyTone;
}

export interface ProxyPanelModel {
  origin: string;
  reachable: boolean;
  statusLabel: string;
  tone: ProxyTone;
  latencyLabel: string | null;
  checkedLabel: string;
  usageLabel: string | null;
  accountsState: "listed" | "unavailable";
  accountsNote?: string;
  providers: ProxyPanelProvider[];
  accounts: ProxyPanelAccount[];
  /** Things that stop work, most severe first. Empty when all is well. */
  alerts: string[];
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
  kimi: "Kimi",
  gemini: "Gemini",
  "cursor-agent": "Cursor",
};

const ACCOUNT_STATUS_LABELS: Record<ProxyAccountWire["status"], string> = {
  ready: "Ready",
  cooldown: "Cooling down",
  disabled: "Disabled",
  error: "Error",
};

const ACCOUNT_TONES: Record<ProxyAccountWire["status"], ProxyTone> = {
  ready: "green",
  cooldown: "amber",
  disabled: "grey",
  error: "red",
};

/** Same threshold as the agent lights: several missed heartbeats. */
const STALE_AFTER_MS = 90_000;

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function relative(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function untilLabel(from: number, until: number): string {
  const seconds = Math.max(0, Math.round((until - from) / 1_000));
  if (seconds < 60) return `lifts in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `lifts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes - hours * 60;
  return rest > 0 ? `lifts in ${hours}h ${rest}m` : `lifts in ${hours}h`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}`;
}

function summarizeProvider(provider: string, accounts: ProxyAccountWire[]): ProxyPanelProvider {
  const ready = accounts.filter((a) => a.status === "ready").length;
  const cooling = accounts.filter((a) => a.status === "cooldown").length;
  const errored = accounts.filter((a) => a.status === "error").length;
  const disabled = accounts.filter((a) => a.status === "disabled").length;
  const parts = [
    ready ? plural(ready, "ready") : null,
    cooling ? plural(cooling, "cooling down") : null,
    errored ? plural(errored, "error") : null,
    disabled ? plural(disabled, "disabled") : null,
  ].filter((part): part is string => part !== null);
  const tone: ProxyTone = ready > 0 ? "green" : cooling > 0 || errored > 0 ? "amber" : "grey";
  return {
    provider,
    label: providerLabel(provider),
    ready,
    cooling,
    errored,
    disabled,
    summary: parts.join(" · ") || "no accounts",
    tone,
  };
}

export function buildProxyPanel(snapshot: HostSnapshotWire | null, now = new Date()): ProxyPanelModel | null {
  const proxy = snapshot?.proxy;
  if (!snapshot || !proxy) return null;

  const hostCheckedAt = Date.parse(snapshot.checkedAt);
  const stale = !Number.isFinite(hostCheckedAt) || now.getTime() - hostCheckedAt > STALE_AFTER_MS;
  const proxyCheckedAt = Date.parse(proxy.checkedAt);
  const checkedLabel = Number.isFinite(proxyCheckedAt) ? relative(proxyCheckedAt, now.getTime()) : "unknown";

  const accountsRaw = proxy.accounts ?? [];
  const accounts: ProxyPanelAccount[] = accountsRaw.map((account) => {
    const cooldownAt = account.cooldownUntil ? Date.parse(account.cooldownUntil) : Number.NaN;
    const cooldownLabel =
      account.status === "cooldown" && Number.isFinite(cooldownAt) ? untilLabel(now.getTime(), cooldownAt) : undefined;
    const detail = account.detail ?? (account.status === "cooldown" ? account.cooldownReason : undefined);
    return {
      id: account.id,
      provider: account.provider,
      providerLabel: providerLabel(account.provider),
      label: account.label,
      status: account.status,
      statusLabel: ACCOUNT_STATUS_LABELS[account.status],
      tone: stale ? "grey" : ACCOUNT_TONES[account.status],
      ...(cooldownLabel ? { cooldownLabel } : {}),
      requestsLabel: `${account.requests24h.success} ok · ${account.requests24h.failed} failed`,
      ...(detail ? { detail } : {}),
      canEnable: account.status === "disabled",
      canDisable: account.status !== "disabled",
      canRefresh: account.status !== "disabled",
    };
  });

  const byProvider = new Map<string, ProxyAccountWire[]>();
  for (const account of accountsRaw) {
    const list = byProvider.get(account.provider) ?? [];
    list.push(account);
    byProvider.set(account.provider, list);
  }
  const providers = [...byProvider.entries()].map(([provider, list]) => summarizeProvider(provider, list));

  const alerts: string[] = [];
  if (!proxy.reachable) alerts.push("Inference proxy unreachable — no run can be served");
  for (const provider of providers) {
    if (provider.ready === 0) alerts.push(`${provider.label} has no ready account on the proxy`);
  }

  const statusLabel = stale ? "Stale" : proxy.reachable ? "Reachable" : "Unreachable";
  const tone: ProxyTone = stale ? "grey" : proxy.reachable ? "green" : "red";

  const usage = proxy.usage;
  const usageLabel = usage
    ? `${usage.total.success + usage.total.failed} requests in 24h · ${usage.total.failed} failed`
    : null;

  return {
    origin: proxy.origin,
    reachable: proxy.reachable,
    statusLabel,
    tone,
    latencyLabel: proxy.reachable && typeof proxy.latencyMs === "number" ? `${proxy.latencyMs} ms` : null,
    checkedLabel,
    usageLabel,
    accountsState: proxy.accounts ? "listed" : "unavailable",
    ...(proxy.accounts ? {} : { accountsNote: proxy.managementError ?? "accounts not reported" }),
    providers,
    accounts,
    alerts,
  };
}
