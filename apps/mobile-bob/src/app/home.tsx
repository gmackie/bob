import { useMemo } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Badge, Card, EmptyState, ListRow, Screen } from "~/components/ui";
import { buildHomeTriage } from "~/features/home/home-model";
import type { HomeTone } from "~/features/home/home-model";
import { buildNodeLights } from "~/features/nodes/node-lights-model";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { trpc } from "~/utils/api";

/**
 * Phone home.
 *
 * home-mode-model always specified triage here ("Phone home is always triage,
 * regardless of mode"), but getAuthenticatedHomeHref hardcoded /chat, so the
 * phone opened on a conversation and there was no view of what needed
 * attention. This is that view: what is waiting on you, what is running, what
 * is queued behind it — plus the agent light, so a run going green is visible
 * without opening anything.
 */

const BADGE: Record<HomeTone, "default" | "warning" | "danger" | "accent"> = {
  danger: "danger",
  warning: "warning",
  accent: "accent",
  muted: "default",
};

/**
 * One dot for the whole host. A stale snapshot reads grey rather than green:
 * node-lights-model treats >90s without a heartbeat as unknown, and claiming
 * "ready" about a host that stopped answering is worse than claiming nothing.
 */
function hostDot(lights: { isStale: boolean; allReady: boolean }): string {
  if (lights.isStale) return "bg-neutral-400";
  return lights.allReady ? "bg-green-500" : "bg-amber-500";
}

export default function HomeScreen() {
  const { workspace } = useSelectedWorkspace();
  const { hostSnapshot, sessions } = useGateway();

  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspace?.id ?? "", limit: 100 },
      { enabled: Boolean(workspace?.id), refetchInterval: 10_000 },
    ),
  );

  const triage = useMemo(
    () => buildHomeTriage({ workItems: workItemsQuery.data ?? [] }),
    [workItemsQuery.data],
  );

  const activeRunCount = sessions.filter((s) => s.status === "running").length;
  const lights = buildNodeLights(hostSnapshot, { activeRunCount });

  return (
    <>
      <Stack.Screen options={{ title: "Home" }} />
      <Screen>
        <ScrollView
          contentContainerClassName="pb-12"
          refreshControl={
            <RefreshControl
              refreshing={workItemsQuery.isRefetching}
              onRefresh={() => void workItemsQuery.refetch()}
            />
          }
        >
          <Card className="mb-4">
            <View className="flex-row items-center gap-2">
              <View className={`h-2.5 w-2.5 rounded-full ${hostDot(lights)}`} />
              <Text className="text-foreground text-base font-semibold">
                {lights.hostId ?? "No host connected"}
              </Text>
            </View>
            <Text className="text-muted mt-1 text-xs">{lights.activityLabel}</Text>
          </Card>

          {workItemsQuery.isLoading ? (
            <ActivityIndicator className="mt-8" />
          ) : triage.isAllClear ? (
            <EmptyState
              icon="✓"
              title="All clear"
              hint="Nothing is waiting on you, running, or queued."
            />
          ) : (
            triage.sections.map((section) => (
              <View key={section.key} className="mb-5">
                <View className="mb-2 flex-row items-baseline justify-between">
                  <Text className="text-foreground text-base font-semibold">
                    {section.title}
                  </Text>
                  <Text className="text-muted text-xs">
                    {section.overflowCount > 0
                      ? `${section.rows.length} of ${section.total}`
                      : String(section.total)}
                  </Text>
                </View>
                <Card>
                  {section.rows.map((row, index) => (
                    <ListRow
                      key={row.id}
                      title={row.title}
                      subtitle={row.identifier}
                      showDivider={index < section.rows.length - 1}
                      onPress={() => router.push(row.href)}
                      right={
                        <Badge variant={BADGE[row.tone]}>{row.statusLabel}</Badge>
                      }
                    />
                  ))}
                </Card>
              </View>
            ))
          )}
        </ScrollView>
      </Screen>
    </>
  );
}
