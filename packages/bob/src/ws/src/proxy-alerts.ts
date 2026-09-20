/**
 * The two proxy states worth a push, and when to send it.
 *
 * An unreachable proxy stops every run; a provider with no ready account stops
 * every run on that provider. Each is one push when it begins — not one per
 * heartbeat, and nothing on recovery, because the panel going green is the
 * message. The gateway keeps the previous state per workspace and diffs.
 *
 * Derived from the same view-model the Nodes page and the phone render, so a
 * push never disagrees with what the screens show.
 */

import type { HostSnapshotWire } from "./protocol";
import { buildProxyPanel, providerLabel } from "./proxy-panel-model";

export interface ProxyAlertState {
  unreachable: boolean;
  /** Bob provider ids, sorted, with no ready account on the proxy. */
  providersWithoutReadyAccount: string[];
}

export type ProxyAlertType = "proxy_unreachable" | "provider_no_ready_accounts";

export interface ProxyAlert {
  type: ProxyAlertType;
  provider?: string;
  title: string;
  body: string;
}

export const QUIET_PROXY_ALERT_STATE: ProxyAlertState = { unreachable: false, providersWithoutReadyAccount: [] };

export function deriveProxyAlertState(snapshot: HostSnapshotWire | null, now = new Date()): ProxyAlertState {
  const panel = buildProxyPanel(snapshot, now);
  // No proxy, or a stale snapshot (grey): nothing to say. An old "unreachable"
  // is not evidence of an outage now.
  if (!panel || panel.tone === "grey") return { ...QUIET_PROXY_ALERT_STATE };
  if (!panel.reachable) return { unreachable: true, providersWithoutReadyAccount: [] };
  return {
    unreachable: false,
    providersWithoutReadyAccount: panel.providers
      .filter((provider) => provider.ready === 0)
      .map((provider) => provider.provider)
      .sort(),
  };
}

/** Alerts that begin in `next` and were not present in `previous`. */
export function diffProxyAlerts(previous: ProxyAlertState | undefined, next: ProxyAlertState): ProxyAlert[] {
  const before = previous ?? QUIET_PROXY_ALERT_STATE;
  const alerts: ProxyAlert[] = [];
  if (next.unreachable && !before.unreachable) {
    alerts.push({
      type: "proxy_unreachable",
      title: "Inference proxy unreachable",
      body: "No run can be served until the proxy is back. Open Nodes to check it.",
    });
  }
  const seen = new Set(before.providersWithoutReadyAccount);
  for (const provider of next.providersWithoutReadyAccount) {
    if (seen.has(provider)) continue;
    const label = providerLabel(provider);
    alerts.push({
      type: "provider_no_ready_accounts",
      provider,
      title: `${label} has no ready account on the proxy`,
      body: `Runs on ${label} will fail until an account is enabled, refreshed, or its cooldown lifts.`,
    });
  }
  return alerts;
}
