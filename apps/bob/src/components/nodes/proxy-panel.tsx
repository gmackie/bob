"use client";

/**
 * The inference proxy, on the node page.
 *
 * Production inference goes through CLIProxyAPI; this is the first place in
 * Bob that shows it. Everything rendered here comes from the host snapshot
 * heartbeat via the shared @bob/ws view-model, so the phone shows the same
 * accounts in the same states. Management actions (refresh, enable, disable)
 * land with the server-side proxy RPC; until then the rows are read-only and
 * say so rather than offering a button that does nothing.
 */

import { useMemo } from "react";

import { Badge } from "@gmacko/core/ui/badge";
import { cn } from "@gmacko/core/ui";
import type { HostSnapshotWire } from "@bob/ws";
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

export function ProxyPanel({ snapshot, now }: { snapshot: HostSnapshotWire | null; now?: Date }) {
  const panel = useMemo(() => buildProxyPanel(snapshot, now), [snapshot, now]);
  if (!panel) return null;

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
      </header>

      {panel.alerts.length > 0 ? (
        <ul className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" data-testid="inference-proxy-alerts">
          {panel.alerts.map((alert) => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
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
              {panel.accounts.map((account) => (
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
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{account.requestsLabel}</td>
                  {account.detail ? (
                    <td className="px-3 py-2 text-xs text-muted-foreground">{account.detail}</td>
                  ) : (
                    <td />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
