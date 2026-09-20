import { Text, View } from "react-native";
import type { HostSnapshotWire, ProxyTone } from "@bob/ws";
import { buildProxyPanel } from "@bob/ws";

/**
 * The inference proxy, on the phone.
 *
 * Same view-model as the web Nodes page (@bob/ws buildProxyPanel), so an
 * account cooling down reads the same on both. Renders nothing for a host
 * that is not routed through a proxy — that is not a problem to report.
 */

const DOT: Record<ProxyTone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  grey: "bg-neutral-400",
};

export function ProxyCard({ snapshot, now }: { snapshot: HostSnapshotWire | null; now?: Date }) {
  const panel = buildProxyPanel(snapshot, now);
  if (!panel) return null;

  return (
    <View className="border-border bg-card mt-4 overflow-hidden rounded-lg border" testID="inference-proxy-card">
      <View className="px-4 py-3">
        <View className="flex-row items-center gap-2">
          <View className={`h-2.5 w-2.5 rounded-full ${DOT[panel.tone]}`} />
          <Text className="text-foreground flex-1 text-sm font-medium">Inference proxy</Text>
          <Text className="text-muted text-xs">{panel.statusLabel}</Text>
        </View>
        <Text className="text-muted mt-1 pl-4.5 text-xs" numberOfLines={1}>
          {panel.origin}
          {panel.latencyLabel ? ` · ${panel.latencyLabel}` : ""} · checked {panel.checkedLabel}
        </Text>
        {panel.usageLabel ? (
          <Text className="text-muted mt-1 pl-4.5 text-xs">{panel.usageLabel}</Text>
        ) : null}
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

      {panel.accountsState === "unavailable" ? (
        <View className="border-border border-t px-4 py-3">
          <Text className="text-muted text-xs leading-4">Accounts not reported: {panel.accountsNote}.</Text>
        </View>
      ) : (
        panel.accounts.map((account) => (
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
          </View>
        ))
      )}
    </View>
  );
}
