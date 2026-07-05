import { Redirect, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Card, Screen } from "~/components/ui";
import {
  buildPriorityQueueControls,
  buildPriorityQueueItems,
  buildPriorityQueueSaveOrder,
  canMoveQueueItem,
  formatStatusLabel,
  getMobilePriorityQueueHeaderModel,
  getQueueItemDispatchAction,
  moveQueueItem,
  sortQueueItemsByPriority,
} from "~/features/tablet/queue";
import { getSessionHref } from "~/features/planning/navigation";
import { getMobileTasksDashboardHref } from "~/features/tablet/navigation";
import type { QueueMoveDirection, TabletQueueItem } from "~/features/tablet/queue";
import { getMobileQueueWorkItemHref } from "~/features/tablet/work-item-entry";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

export default function PriorityQueueScreen() {
  const { data: session, isPending } = authClient.useSession();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const listInput = { workspaceId: workspace?.id ?? "", limit: 100 };
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      listInput,
      { enabled: Boolean(workspace?.id), refetchInterval: 10_000 },
    ),
  );
  const rows = useMemo(
    () => buildPriorityQueueItems((workItemsQuery.data ?? []) as TabletQueueItem[]),
    [workItemsQuery.data],
  );
  const header = getMobilePriorityQueueHeaderModel();
  const defaultOrder = useMemo(() => buildPriorityQueueSaveOrder(rows), [rows]);
  const orderedRows = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = localOrder.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
    const missing = rows.filter((row) => !localOrder.includes(row.id));
    return [...ordered, ...missing];
  }, [localOrder, rows]);

  useEffect(() => {
    setLocalOrder(defaultOrder);
  }, [defaultOrder.join("|")]);

  const reorderMutation = useMutation(
    trpc.workItems.reorderQueue.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
      },
    }),
  );
  const dispatchMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
        if (typeof result.sessionId === "string") {
          router.push(getSessionHref(result.sessionId, workspace?.id) as never);
        }
      },
    }),
  );
  const controls = buildPriorityQueueControls({
    itemCount: orderedRows.length,
    isSaving: reorderMutation.isPending,
  });

  const saveQueue = (workItemIds = buildPriorityQueueSaveOrder(orderedRows)) => {
    if (!workspace?.id) return;
    reorderMutation.mutate({ workspaceId: workspace.id, workItemIds });
  };

  const moveItem = (itemId: string, direction: QueueMoveDirection) => {
    setLocalOrder((current) => moveQueueItem(current, itemId, direction, orderedRows));
  };

  const sortByPriority = () => {
    setLocalOrder(buildPriorityQueueSaveOrder(sortQueueItemsByPriority(orderedRows)));
  };

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
              {header.title}
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

        <View className="mb-4 flex-row flex-wrap items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save priority queue"
            disabled={controls[0]?.disabled ?? true}
            onPress={() => saveQueue()}
            className="rounded-md px-4 py-2 active:opacity-75"
            style={{
              backgroundColor: colors.primary,
              opacity: controls[0]?.disabled ? 0.55 : 1,
            }}
          >
            <Text className="text-sm font-semibold text-background">
              {controls[0]?.label ?? "Save queue"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sort priority queue by priority"
            disabled={controls[1]?.disabled ?? true}
            onPress={sortByPriority}
            className="rounded-md px-4 py-2 active:opacity-75"
            style={{
              backgroundColor: colors.secondary,
              opacity: controls[1]?.disabled ? 0.55 : 1,
            }}
          >
            <Text className="text-sm font-semibold text-foreground">
              {controls[1]?.label ?? "Sort priority"}
            </Text>
          </Pressable>
          <Text className="text-xs text-muted">
            {orderedRows.length} queued
          </Text>
        </View>

        {workItemsQuery.isLoading ? (
          <Card>
            <View className="items-center py-8">
              <ActivityIndicator color={colors.muted} />
            </View>
          </Card>
        ) : orderedRows.length > 0 ? (
          <View className="mb-8 gap-3">
            {orderedRows.map((item, index) => (
              <QueueRow
                key={item.id}
                item={item}
                index={index}
                onOpen={() => router.push(getMobileQueueWorkItemHref(item.id, workspace?.id) as never)}
                onMove={moveItem}
                canMoveUp={canMoveQueueItem(orderedRows, item.id, "up")}
                canMoveDown={canMoveQueueItem(orderedRows, item.id, "down")}
                onDispatch={(workItemId) => dispatchMutation.mutate({ workItemId })}
                isBusy={reorderMutation.isPending || dispatchMutation.isPending}
              />
            ))}
          </View>
        ) : (
          <Card>
            <Text className="text-sm text-muted">No queued work items.</Text>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function QueueRow({
  item,
  index,
  onOpen,
  onMove,
  canMoveUp,
  canMoveDown,
  onDispatch,
  isBusy,
}: {
  item: TabletQueueItem;
  index: number;
  onOpen: () => void;
  onMove: (itemId: string, direction: QueueMoveDirection) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDispatch: (workItemId: string) => void;
  isBusy: boolean;
}) {
  const dispatchAction = getQueueItemDispatchAction(item);

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.identifier} ${item.title}`}
        onPress={onOpen}
        className="active:opacity-75"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
              {item.identifier} · {item.title}
            </Text>
            <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
              Priority {item.priority ?? "none"} · Queue #{index + 1}
            </Text>
          </View>
          <Badge variant="accent">{formatStatusLabel(item.status)}</Badge>
        </View>
      </Pressable>

      <View className="mt-4 flex-row flex-wrap gap-2">
        <QueueAction
          label="Up"
          disabled={isBusy || !canMoveUp}
          onPress={() => onMove(item.id, "up")}
        />
        <QueueAction
          label="Down"
          disabled={isBusy || !canMoveDown}
          onPress={() => onMove(item.id, "down")}
        />
        <QueueAction
          label="Start"
          disabled={isBusy || dispatchAction.kind !== "dispatch"}
          primary
          onPress={() => onDispatch(item.id)}
        />
      </View>
    </Card>
  );
}

function QueueAction({
  label,
  disabled,
  primary,
  onPress,
}: {
  label: string;
  disabled: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="rounded-md px-3 py-2 active:opacity-70"
      style={{
        backgroundColor: primary ? colors.primary : colors.secondary,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text
        className="text-xs font-semibold"
        style={{ color: primary ? colors.background : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
