import { useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  filterTaskLaneWorkItems,
  getTaskLaneRowModel,
  getTaskLaneWorkItemTarget,
} from "~/features/tablet/dashboard";
import type { TaskLaneKey } from "~/features/tablet/dashboard";
import type { TabletQueueItem } from "~/features/tablet/queue";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { trpc } from "~/utils/api";

const LANE_TITLE: Record<TaskLaneKey, string> = {
  "needs-attention": "Needs Attention",
  ready: "Ready",
  active: "Active",
  review: "Review",
};

export function TaskLaneTablePane({
  lane,
  onOpenWorkItem,
}: {
  lane: TaskLaneKey;
  onOpenWorkItem: (workItemId: string, view?: "queue" | "outcome") => void;
}) {
  const { workspace } = useSelectedWorkspace();
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workspace?.id ?? "", limit: 100 },
      { enabled: Boolean(workspace?.id), refetchInterval: 10_000 },
    ),
  );
  const workItems = useMemo(
    () => filterTaskLaneWorkItems((workItemsQuery.data ?? []) as TabletQueueItem[], lane),
    [lane, workItemsQuery.data],
  );

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      <View className="mb-5 flex-row items-start justify-between">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            {LANE_TITLE[lane]}
          </Text>
          <Text className="mt-1 text-sm text-muted" numberOfLines={1}>
            {workspace?.name ?? "Workspace"} task table
          </Text>
        </View>
        <Text className="ml-4 text-sm font-semibold text-muted">
          {workItems.length}
        </Text>
      </View>

      <View
        className="overflow-hidden rounded-lg border"
        style={{ borderColor: colors.border, backgroundColor: colors.card }}
      >
        <View
          className="flex-row px-4 py-2"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider text-muted"
            style={{ flex: 1.2 }}
          >
            ID
          </Text>
          <Text
            className="text-xs font-semibold uppercase tracking-wider text-muted"
            style={{ flex: 3 }}
          >
            Title
          </Text>
          <Text
            className="text-xs font-semibold uppercase tracking-wider text-muted"
            style={{ flex: 1.2 }}
          >
            Status
          </Text>
        </View>

        {workItemsQuery.isLoading ? (
          <View className="items-center py-10">
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : workItems.length === 0 ? (
          <Text className="px-4 py-5 text-sm text-muted">
            No work items in this state.
          </Text>
        ) : (
          workItems.map((item, index) => {
            const row = getTaskLaneRowModel(item, lane);

            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  const target = getTaskLaneWorkItemTarget(item, lane);
                  onOpenWorkItem(target.workItemId, target.view);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.identifier} ${item.title}`}
                className="flex-row px-4 py-3 active:opacity-70"
                style={{
                  borderBottomWidth: index < workItems.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  minHeight: 44,
                }}
              >
                <Text
                  className="text-sm font-medium text-muted"
                  numberOfLines={1}
                  style={{ flex: 1.2 }}
                >
                  {item.identifier}
                </Text>
                <Text
                  className="text-sm font-semibold text-foreground"
                  numberOfLines={1}
                  style={{ flex: 3 }}
                >
                  {item.title}
                </Text>
                <Text
                  className="text-sm text-muted"
                  numberOfLines={1}
                  style={{ flex: 1.2 }}
                >
                  {row.statusLabel}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
