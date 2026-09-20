"use client";

/**
 * The inference proxy, on the node page.
 *
 * Production inference goes through CLIProxyAPI; this is the first place in
 * Bob that shows it. Everything rendered here comes from the host snapshot
 * heartbeat via the shared @bob/ws view-model, so the phone shows the same
 * accounts in the same states.
 *
 * Actions go through proxyControl.set → gateway → the runner, which holds the
 * proxy's management key. The proxy's answer arrives asynchronously as a
 * proxy_control_result frame, followed by a fresh snapshot; `lastResult` is
 * that frame and `pending` is the request still in flight. With no `onAction`
 * the panel is read-only and renders no controls: a button that does nothing
 * is worse than none.
 */

import { useMemo } from "react";

import { Badge } from "@gmacko/core/ui/badge";
import { cn } from "@gmacko/core/ui";
import type { HostSnapshotWire, ProxyControlAction } from "@bob/ws";
import { buildProxyPanel, type ProxyTone } from "@bob/ws";

const TONE_DOT: Record<ProxyTone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  grey: "bg-neutral-400",
};

const TONE_BADGE: Record<ProxyTone, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  grey: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
};

export interface ProxyActionRequest {
  action: ProxyControlAction;
  accountId?: string;
}

export interface ProxyPanelProps {
  snapshot: HostSnapshotWire | null;
  now?: Date;
  /** Present when the viewer may act (workspace owner, daemon online). */
  onAction?: (request: ProxyActionRequest) => void;
  /** The request in flight, if any; disables the controls meanwhile. */
  pending?: ProxyActionRequest | null;
  /** The proxy's answer to the last action. */
  lastResult?: { ok: boolean; detail?: string } | null;
}

const ACTION_BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted disabled:opacity-50";

export function ProxyPanel({ snapshot, now, onAction, pending, lastResult }: ProxyPanelProps) {
  const panel = useMemo(() => buildProxyPanel(snapshot, now), [snapshot, now]);
  if (!panel) return null;

  const busy = Boolean(pending);
  const act = (request: ProxyActionRequest) => onAction?.(request);

  return (
    <section
      className="mt-4 rounded-md border border-border"
      data-testid="inference-proxy-panel"
      aria-label="Inference proxy"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className={cn("inline-block size-2.5 rounded-full", TONE_DOT[panel.tone])} />
        <span className="font-medium">Inference proxy</span>
        <Badge className={cn("text-xs", TONE_BADGE[panel.tone])}>{panel.statusLabel}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{panel.origin}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {panel.latencyLabel ? `${panel.latencyLabel} · ` : ""}checked {panel.checkedLabel}
        </span>
        {onAction ? (
          <button
            type="button"
            className={ACTION_BUTTON}
            disabled={busy}
            data-testid="proxy-action-test"
            onClick={() => act({ action: "test" })}
          >
            {pending?.action === "test" ? "Testing…" : "Test connection"}
          </button>
        ) : null}
      </header>

      {panel.alerts.length > 0 ? (
        <ul
          className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
          data-testid="inference-proxy-alerts"
        >
          {panel.alerts.map((alert) => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
      ) : null}

      {lastResult ? (
        <p
          className={cn(
            "border-b border-border px-3 py-2 text-xs",
            lastResult.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
          )}
          data-testid="inference-proxy-result"
          role="status"
        >
          {lastResult.ok ? "The proxy accepted the change." : "The proxy refused:"}
          {lastResult.detail ? ` ${lastResult.detail}` : ""}
        </p>
      ) : null}

      {panel.accountsState === "unavailable" ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Accounts not reported: {panel.accountsNote}. Set{" "}
          <code className="font-mono">CLIPROXY_MANAGEMENT_KEY</code> on the runner to list them here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-3 py-2">
            {panel.providers.map((provider) => (
              <span
                key={provider.provider}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                data-testid={`inference-proxy-provider-${provider.provider}`}
              >
                <span className={cn("inline-block size-2 rounded-full", TONE_DOT[provider.tone])} />
                <span className="font-medium">{provider.label}</span>
                <span className="text-muted-foreground">{provider.summary}</span>
              </span>
            ))}
            {panel.usageLabel ? (
              <span className="ml-auto self-center text-xs text-muted-foreground">{panel.usageLabel}</span>
            ) : null}
          </div>

          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {panel.accounts.map((account) => {
                const inFlight = pending?.accountId === account.id ? pending.action : null;
                return (
                  <tr key={account.id} data-testid={`inference-proxy-account-${account.id}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{account.providerLabel}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{account.label}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={cn("text-xs", TONE_BADGE[account.tone])}>{account.statusLabel}</Badge>
                      {account.cooldownLabel ? (
                        <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">{account.cooldownLabel}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                      {account.requestsLabel}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{account.detail ?? ""}</td>
                    {onAction ? (
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-1.5">
                          {account.canRefresh ? (
                            <button
                              type="button"
                              className={ACTION_BUTTON}
                              disabled={busy}
                              data-testid={`proxy-action-refresh-${account.id}`}
                              onClick={() => act({ action: "refresh", accountId: account.id })}
                            >
                              {inFlight === "refresh" ? "Refreshing…" : "Refresh"}
                            </button>
                          ) : null}
                          {account.canDisable ? (
                            <button
                              type="button"
                              className={ACTION_BUTTON}
                              disabled={busy}
                              data-testid={`proxy-action-disable-${account.id}`}
                              onClick={() => act({ action: "disable", accountId: account.id })}
                            >
                              {inFlight === "disable" ? "Disabling…" : "Disable"}
                            </button>
                          ) : null}
                          {account.canEnable ? (
                            <button
                              type="button"
                              className={cn(ACTION_BUTTON, "border-primary text-primary")}
                              disabled={busy}
                              data-testid={`proxy-action-enable-${account.id}`}
                              onClick={() => act({ action: "enable", accountId: account.id })}
                            >
                              {inFlight === "enable" ? "Enabling…" : "Enable"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
