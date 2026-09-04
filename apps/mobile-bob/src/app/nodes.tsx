import { ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";

import { useGateway } from "~/hooks/use-gateway";
import { RelatedAppsCard } from "~/features/links/RelatedAppsCard";
import { buildNodeLights } from "~/features/nodes/node-lights-model";
import type { LightTone } from "~/features/nodes/node-lights-model";

/**
 * Agent lights for the workspace's host.
 *
 * Driven by the gateway's host snapshot, which the daemon pushes on every
 * heartbeat — so the lights move on their own while a run is going rather than
 * only on pull-to-refresh. Watching a light go green from a phone is the point
 * of the screen.
 *
 * The status rules come from the shared @bob/ws model, so this agrees with the
 * web dashboard and the tablet cockpit about the same agent.
 */

const DOT: Record<LightTone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  grey: "bg-neutral-400",
};

export default function NodesScreen() {
  const { hostSnapshot, sessions, connectionState } = useGateway();

  const activeRunCount = sessions.filter((s) => s.status === "running").length;
  const model = buildNodeLights(hostSnapshot, { activeRunCount });

  return (
    <>
      <Stack.Screen options={{ title: "Nodes" }} />
      <ScrollView className="bg-background flex-1" contentContainerClassName="p-4 pb-12">
        <View className="flex-row items-center gap-2">
          <Text className="text-foreground text-lg font-semibold">
            {model.hostId ?? "No host"}
          </Text>
          {/* Live, not a refresh count: this is the number that moves while a
              run is going. */}
          <Text className="text-muted text-sm">{model.activityLabel}</Text>
        </View>

        {/* Say the host has gone quiet rather than leaving stale lights that
            claim green about something that stopped answering. */}
        {model.isStale ? (
          <Text className="text-muted mt-1 text-xs leading-5">
            {connectionState === "connected"
              ? "Waiting for the host to report…"
              : "Reconnecting to the gateway…"}
          </Text>
        ) : null}

        {model.lights.length > 0 ? (
          <View className="border-border bg-card mt-4 overflow-hidden rounded-lg border">
            {model.lights.map((light, index) => (
              <View
                key={light.provider}
                className={`px-4 py-3 ${index > 0 ? "border-border border-t" : ""}`}
              >
                <View className="flex-row items-center gap-2">
                  <View className={`h-2.5 w-2.5 rounded-full ${DOT[light.tone]}`} />
                  <Text className="text-foreground flex-1 text-sm font-medium">
                    {light.label}
                  </Text>
                  <Text className="text-muted text-xs">{light.statusLabel}</Text>
                </View>
                {light.detail ? (
                  <Text className="text-muted mt-1 pl-4.5 text-xs leading-4" numberOfLines={2}>
                    {light.detail}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {/* Bob does not render deploys or node infra; ForgeGraph does. */}
        <RelatedAppsCard
          requests={
            model.hostId
              ? [{ target: "forgegraph.node", id: model.hostId }, { target: "forgegraph.alerts" }]
              : [{ target: "forgegraph.alerts" }]
          }
        />
      </ScrollView>
    </>
  );
}
