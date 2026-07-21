import { Redirect, router } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { Badge, Card, Screen } from "~/components/ui";
import {
  buildRecentOutcomeRailRows,
  buildTabletShellSessionsFromAgentRuns,
} from "~/features/tablet/shell";
import type {
  TabletAgentRunSessionInput,
  TabletRecentOutcomeRailRow,
} from "~/features/tablet/shell";
import { getMobileTasksDashboardHref } from "~/features/tablet/navigation";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export default function RecentOutcomesScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { workspace } = useSelectedWorkspace();
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspace?.id ?? "", limit: 100 },
      { enabled: Boolean(workspace?.id), refetchInterval: 10_000 },
    ),
  );
  const sessionsQuery = useQuery(
    trpc.agentRun.list.queryOptions(
      { workspaceId: workspace?.id ?? "", limit: 100 },
      { enabled: Boolean(workspace?.id), refetchInterval: 10_000 },
    ),
  );
  const rows = useMemo(
    () => buildRecentOutcomeRailRows({
      workspaceId: workspace?.id,
      workItems: workItemsQuery.data ?? [],
      sessions: buildTabletShellSessionsFromAgentRuns(
        (sessionsQuery.data ?? []) as TabletAgentRunSessionInput[],
      ),
      limit: 100,
    }),
    [sessionsQuery.data, workItemsQuery.data, workspace?.id],
  );

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={colors.muted} />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5 flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-3xl font-semibold tracking-tight text-foreground">
              Recent Outcomes
            </Text>
            <Text className="mt-1 text-sm text-muted" numberOfLines={1}>
              Completed, errored, cancelled, and interrupted execution sessions
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to tasks"
            onPress={() => router.replace(getMobileTasksDashboardHref(workspace?.id) as never)}
            className="rounded-md px-3 py-2 active:opacity-70"
            style={{ backgroundColor: colors.secondary }}
          >
            <Text className="text-sm font-semibold text-foreground">Tasks</Text>
          </Pressable>
        </View>

        <View className="mb-8 gap-2">
          {workItemsQuery.isLoading || sessionsQuery.isLoading ? (
            <Card>
              <View className="items-center py-8">
                <ActivityIndicator color={colors.muted} />
              </View>
            </Card>
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <OutcomeRow
                key={row.id}
                item={row}
                onPress={() => router.push(row.href as never)}
              />
            ))
          ) : (
            <Card>
              <Text className="text-sm text-muted">No recent outcomes yet.</Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function OutcomeRow({
  item,
  onPress,
}: {
  item: TabletRecentOutcomeRailRow;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      onPress={onPress}
      className="rounded-lg border p-4 active:opacity-75"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
            {item.agentLabel} · {item.lastUpdatedLabel}
          </Text>
        </View>
        <Badge variant={item.statusTone}>
          {item.statusLabel}
        </Badge>
      </View>
    </Pressable>
  );
}
