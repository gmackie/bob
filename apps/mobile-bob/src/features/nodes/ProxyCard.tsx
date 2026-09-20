import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { HostSnapshotWire, ProxyControlAction, ProxyTone } from "@bob/ws";
import { buildProxyPanel } from "@bob/ws";

import { rpc } from "~/utils/api";

/**
 * The inference proxy, on the phone.
 *
 * Same view-model as the web Nodes page (@bob/ws buildProxyPanel), so an
 * account cooling down reads the same on both. Renders nothing for a host
 * that is not routed through a proxy — that is not a problem to report.
 *
 * Actions go through proxyControl.set; the proxy's answer arrives over the
 * gateway socket as `lastResult` and the runner pushes a fresh snapshot right
 * after. Enable and disable ask first: enabling spends the owner's
 * subscription, and a thumb slips.
 */

const DOT: Record<ProxyTone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-neutral-400",
};

const ACTION_LABELS: Record<ProxyControlAction, string> = {
  refresh: "Refresh",
  enable: "Enable",
  disable: "Disable",
  test: "Test",
};

export function ProxyCard({
  snapshot,
  workspaceId,
  lastResult,
  now,
}: {
  snapshot: HostSnapshotWire | null;
  /** Present when the viewer may act; without it the card is read-only. */
  workspaceId?: string | null;
  lastResult?: { ok: boolean; detail?: string } | null;
  now?: Date;
}) {
  const panel = buildProxyPanel(snapshot, now);
  const [pending, setPending] = useState<{ action: ProxyControlAction; accountId?: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const mutation = useMutation(rpc("proxyControl.set").mutationOptions({}));

  if (!panel) return null;

  const canAct = Boolean(workspaceId);
  const busy = pending !== null && mutation.isPending;
  const shown = sendError ? { ok: false, detail: sendError } : lastResult;

  const send = (action: ProxyControlAction, accountId?: string) => {
    if (!workspaceId) return;
    setPending({ action, accountId });
    setSendError(null);
    mutation.mutate(
      {
        workspaceId,
        requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        action,
        ...(accountId ? { accountId } : {}),
      },
      {
        onError: (error) => setSendError(error.message),
        onSettled: () => setPending(null),
      },
    );
  };

  const confirmThen = (action: ProxyControlAction, accountLabel: string, accountId: string) => {
    Alert.alert(
      `${ACTION_LABELS[action]} ${accountLabel}?`,
      action === "enable"
        ? "The proxy will start serving runs from this account again."
        : "The proxy will stop serving runs from this account until it is enabled again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: ACTION_LABELS[action], style: action === "disable" ? "destructive" : "default", onPress: () => send(action, accountId) },
      ],
    );
  };

  return (
    <View className="border-border bg-card mt-4 overflow-hidden rounded-lg border" testID="inference-proxy-card">
      <View className="px-4 py-3">
        <View className="flex-row items-center gap-2">
          <View className={`h-2.5 w-2.5 rounded-full ${DOT[panel.tone]}`} />
          <Text className="text-foreground flex-1 text-sm font-medium">Inference proxy</Text>
          <Text className="text-muted text-xs">{panel.statusLabel}</Text>
          {canAct ? (
            <Pressable
              onPress={() => send("test")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Test proxy connection"
              className="border-border ml-2 rounded-md border px-2 py-0.5 active:opacity-70"
              testID="proxy-action-test"
            >
              <Text className="text-accent text-xs font-semibold">{pending?.action === "test" ? "Testing…" : "Test"}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text className="text-muted mt-1 pl-4.5 text-xs" numberOfLines={1}>
          {panel.origin}
          {panel.latencyLabel ? ` · ${panel.latencyLabel}` : ""} · checked {panel.checkedLabel}
        </Text>
        {panel.usageLabel ? <Text className="text-muted mt-1 pl-4.5 text-xs">{panel.usageLabel}</Text> : null}
      </View>

      {panel.alerts.length > 0 ? (
        <View className="border-border border-t bg-amber-500/10 px-4 py-2" testID="inference-proxy-alerts">
          {panel.alerts.map((alert) => (
            <Text key={alert} className="text-warning text-xs leading-4">
              {alert}
            </Text>
          ))}
        </View>
      ) : null}

      {shown ? (
        <View className="border-border border-t px-4 py-2" testID="inference-proxy-result">
          <Text className={`text-xs leading-4 ${shown.ok ? "text-success" : "text-danger"}`}>
            {shown.ok ? "The proxy accepted the change." : "The proxy refused."}
            {shown.detail ? ` ${shown.detail}` : ""}
          </Text>
        </View>
      ) : null}

      {panel.accountsState === "unavailable" ? (
        <View className="border-border border-t px-4 py-3">
          <Text className="text-muted text-xs leading-4">Accounts not reported: {panel.accountsNote}.</Text>
        </View>
      ) : (
        panel.accounts.map((account) => {
          const inFlight = pending?.accountId === account.id ? pending.action : null;
          return (
            <View key={account.id} className="border-border border-t px-4 py-3" testID={`inference-proxy-account-${account.id}`}>
              <View className="flex-row items-center gap-2">
                <View className={`h-2.5 w-2.5 rounded-full ${DOT[account.tone]}`} />
                <Text className="text-foreground text-sm font-medium">{account.providerLabel}</Text>
                <Text className="text-muted flex-1 text-xs" numberOfLines={1}>
                  {account.label}
                </Text>
                <Text className="text-muted text-xs">{account.statusLabel}</Text>
              </View>
              <Text className="text-muted mt-1 pl-4.5 text-xs" numberOfLines={1}>
                {account.requestsLabel}
                {account.cooldownLabel ? ` · ${account.cooldownLabel}` : ""}
                {account.detail ? ` · ${account.detail}` : ""}
              </Text>
              {canAct ? (
                <View className="mt-2 flex-row gap-2 pl-4.5">
                  {account.canRefresh ? (
                    <Pressable
                      onPress={() => send("refresh", account.id)}
                      disabled={busy}
                      accessibilityRole="button"
                      className="border-border rounded-md border px-2 py-1 active:opacity-70"
                      testID={`proxy-action-refresh-${account.id}`}
                    >
                      <Text className="text-foreground text-xs font-semibold">
                        {inFlight === "refresh" ? "Refreshing…" : "Refresh"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {account.canDisable ? (
                    <Pressable
                      onPress={() => confirmThen("disable", account.label, account.id)}
                      disabled={busy}
                      accessibilityRole="button"
                      className="border-border rounded-md border px-2 py-1 active:opacity-70"
                      testID={`proxy-action-disable-${account.id}`}
                    >
                      <Text className="text-foreground text-xs font-semibold">
                        {inFlight === "disable" ? "Disabling…" : "Disable"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {account.canEnable ? (
                    <Pressable
                      onPress={() => confirmThen("enable", account.label, account.id)}
                      disabled={busy}
                      accessibilityRole="button"
                      className="border-accent rounded-md border px-2 py-1 active:opacity-70"
                      testID={`proxy-action-enable-${account.id}`}
                    >
                      <Text className="text-accent text-xs font-semibold">{inFlight === "enable" ? "Enabling…" : "Enable"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}
