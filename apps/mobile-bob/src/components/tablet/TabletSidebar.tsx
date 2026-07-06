import { useState } from "react";
import { Text, View, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { GatewaySession } from "~/hooks/use-gateway";
import type { ConnectionState } from "@bob/ws";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { hapticLight, hapticSelection } from "~/lib/haptics";
import {
  buildExecutionQueue,
  buildPriorityQueueControls,
  buildPriorityQueueItems,
  buildPriorityQueueSaveOrder,
  canMoveQueueItem,
  formatStatusLabel,
  moveQueueItem,
  sortQueueItemsByPriority,
} from "~/features/tablet/queue";
import {
  getTabletRailProjectQueryOptions,
  getTabletRailWorkItemQueryOptions,
} from "~/features/tablet/rail-refresh";
import type {
  QueueMoveDirection,
  TabletQueueItem,
} from "~/features/tablet/queue";
import {
  buildLeftRailTabBadges,
  buildRecentOutcomeRailRows,
  getShellModeItems,
  getShellHeaderTitle,
  buildShellSessionRows,
  getLeftRailTabs,
  getShellHeaderStatusLabel,
  groupShellSessions,
  matchesShellSessionStatusFilter,
} from "~/features/tablet/shell";
import {
  buildMobileProjectRailRows

} from "~/features/planning/project-status";
import type {MobileProjectStatusEntry} from "~/features/planning/project-status";
import type {
  TabletLeftRailTabBadges,
  TabletRecentOutcomeRailRow,
  TabletShellSessionRow,
  TabletShellStatusFilter,
  TabletShellStatusTone,
  TabletLeftRailTab,
  TabletShellMode,
} from "~/features/tablet/shell";
import type { MobileWorkItemEntryView } from "~/features/tablet/work-item-entry";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function ModeSwitch({
  mode,
  onModeChange,
}: {
  mode: TabletShellMode;
  onModeChange: (mode: TabletShellMode) => void;
}) {
  return (
    <View
      className="flex-row rounded-lg p-1"
      style={{ backgroundColor: colors.secondary }}
    >
      {getShellModeItems().map((item) => (
        <Pressable
          key={item.key}
          testID={`tablet-mode-${item.key}`}
          onPress={() => {
            hapticSelection();
            onModeChange(item.key);
          }}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityHint={`Switch to ${item.label} mode`}
          accessibilityState={{ selected: mode === item.key }}
          className="flex-1 rounded-md px-2 py-1.5 active:opacity-70"
          style={{
            backgroundColor: mode === item.key ? colors.primary : "transparent",
            minHeight: 32,
            justifyContent: "center",
          }}
        >
          <Text
            className="text-center text-xs font-semibold"
            style={{ color: mode === item.key ? colors.background : colors.muted }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function TabBar({
  mode,
  tab,
  badges,
  onTabChange,
}: {
  mode: TabletShellMode;
  tab: TabletLeftRailTab;
  badges: TabletLeftRailTabBadges;
  onTabChange: (tab: TabletLeftRailTab) => void;
}) {
  const tabs = getLeftRailTabs(mode);

  return (
    <View
      className="flex-row"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      {tabs.map((t) => (
        <Pressable
          key={t.key}
          testID={`tablet-tab-${t.key}`}
          onPress={() => { hapticSelection(); onTabChange(t.key); }}
          accessibilityRole="tab"
          accessibilityLabel={t.label}
          accessibilityState={{ selected: tab === t.key }}
          className="flex-1 items-center py-2.5 active:opacity-70"
          style={{
            borderBottomWidth: 2,
            borderBottomColor: tab === t.key ? colors.primary : "transparent",
          }}
        >
          <View
            className="flex-row items-center justify-center gap-1.5"
            style={{ minHeight: 20 }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: tab === t.key ? colors.foreground : colors.muted }}
            >
              {t.label}
            </Text>
            <View
              className="items-center justify-center rounded-full px-1.5"
              style={{
                minWidth: 20,
                minHeight: 18,
                backgroundColor: tab === t.key ? colors.primary + "25" : colors.secondary,
              }}
            >
              <Text
                className="text-[10px] font-semibold"
                style={{ color: tab === t.key ? colors.primary : colors.muted }}
              >
                {badges[t.key]}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

const FILTERS: { key: TabletShellStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Done" },
  { key: "failed", label: "Failed" },
];

const STATUS_TONE_COLORS: Record<TabletShellStatusTone, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  default: colors.muted,
};

function SessionRow({
  row,
  isSelected,
  onPress,
}: {
  row: TabletShellSessionRow<GatewaySession>;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.statusLabel}, updated ${row.lastUpdatedLabel}`}
      accessibilityState={{ selected: isSelected }}
      className="flex-row items-center px-4 py-3 active:opacity-70"
      style={{
        minHeight: 44,
        backgroundColor: isSelected ? colors.cardElevated : "transparent",
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: STATUS_TONE_COLORS[row.statusTone],
          marginRight: 12,
        }}
      />
      <View className="flex-1">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {row.title}
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Text
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              color: STATUS_TONE_COLORS[row.statusTone],
              backgroundColor: `${STATUS_TONE_COLORS[row.statusTone]}20`,
            }}
          >
            {row.statusLabel}
          </Text>
          <Text
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted"
            numberOfLines={1}
            style={{ backgroundColor: colors.secondary, maxWidth: 78 }}
          >
            {row.agentLabel}
          </Text>
          {row.detailLabel ? (
            <Text
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted"
              numberOfLines={1}
              style={{ backgroundColor: colors.secondary, maxWidth: 96 }}
            >
              {row.detailLabel}
            </Text>
          ) : null}
          <Text className="text-xs text-muted" numberOfLines={1}>
            {row.lastUpdatedLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function AgentsTab({
  sessions,
  connectionState,
  selectedSessionId,
  onSelectSession,
  onRefresh,
}: {
  sessions: GatewaySession[];
  connectionState: ConnectionState;
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onRefresh?: () => void;
}) {
  const [filter, setFilter] = useState<TabletShellStatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const filtered = filter === "all"
    ? sessions
    : sessions.filter((session) =>
        matchesShellSessionStatusFilter(session.status, filter),
      );
  const rows = buildShellSessionRows(filtered);

  const handleRefresh = () => {
    setRefreshing(true);
    onRefresh?.();
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <>
      <View
        className="flex-row px-3 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => { hapticSelection(); setFilter(f.key); }}
            accessibilityRole="button"
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityState={{ selected: filter === f.key }}
            className="mr-1.5 rounded-full px-3 py-1 active:opacity-70"
            style={{
              backgroundColor: filter === f.key ? colors.primary + "30" : colors.secondary,
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Text
              className="text-xs font-medium"
              style={{ color: filter === f.key ? colors.primary : colors.muted }}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.muted} />
        }
      >
        {rows.length === 0 ? (
          <View className="items-center justify-center px-4 py-12">
            <Text className="text-sm text-muted">
              {connectionState === "connected" ? "No agent sessions" : "Connecting..."}
            </Text>
          </View>
        ) : (
          <>
            <View>
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Recent Outcomes</Text>
              {rows.map((row) => (
                <SessionRow
                  key={row.sessionId}
                  row={row}
                  isSelected={row.sessionId === selectedSessionId}
                  onPress={() => onSelectSession(row.sessionId)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Work Items tab
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<string, string> = {
  task: "T",
  bug: "B",
  feature: "F",
  issue: "I",
};

function WorkItemRow({
  item,
  isSelected,
  onPress,
  onMove,
  canMoveUp,
  canMoveDown,
  onRun,
  onOpenSession,
  isReordering,
  isDispatching,
}: {
  item: TabletQueueItem;
  isSelected: boolean;
  onPress: () => void;
  onMove: (itemId: string, direction: QueueMoveDirection) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRun: (itemId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  isReordering: boolean;
  isDispatching: boolean;
}) {
  const activeSession = item.agentStatus;

  return (
    <View
      style={{
        backgroundColor: isSelected ? colors.cardElevated : "transparent",
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Pressable
        onPress={() => { hapticLight(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={`${item.identifier} ${item.title}, ${item.status}`}
        accessibilityState={{ selected: isSelected }}
        className="px-4 py-3 active:opacity-70"
        style={{ minHeight: 44 }}
      >
        <View className="flex-row items-start">
          <View
            className="mr-3 items-center justify-center rounded"
            style={{
              width: 24,
              height: 24,
              backgroundColor: colors.primary + "25",
            }}
          >
            <Text className="text-xs font-bold text-primary">
              {KIND_ICONS[item.kind] ?? item.kind[0]?.toUpperCase()}
            </Text>
          </View>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text
              className="text-sm font-medium text-foreground"
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text className="mt-0.5 text-xs text-muted">
              {item.identifier} · {formatStatusLabel(item.status)}
              {activeSession ? ` · ${activeSession.status}` : ""}
            </Text>
          </View>
        </View>
      </Pressable>

      <View className="flex-row items-center px-4 pb-3 pl-11">
        <Pressable
          onPress={() => onMove(item.id, "up")}
          disabled={!canMoveUp || isReordering}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.identifier} up`}
          className="mr-2 rounded-md px-2.5 py-1.5 active:opacity-70"
          style={{
            backgroundColor: colors.secondary,
            opacity: !canMoveUp || isReordering ? 0.45 : 1,
            minHeight: 32,
            justifyContent: "center",
          }}
        >
          <Text className="text-xs font-medium text-foreground">Up</Text>
        </Pressable>
        <Pressable
          onPress={() => onMove(item.id, "down")}
          disabled={!canMoveDown || isReordering}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.identifier} down`}
          className="mr-2 rounded-md px-2.5 py-1.5 active:opacity-70"
          style={{
            backgroundColor: colors.secondary,
            opacity: !canMoveDown || isReordering ? 0.45 : 1,
            minHeight: 32,
            justifyContent: "center",
          }}
        >
          <Text className="text-xs font-medium text-foreground">Down</Text>
        </Pressable>

        <View className="flex-1" />

        {activeSession ? (
          <Pressable
            onPress={() => onOpenSession?.(activeSession.sessionId)}
            accessibilityRole="button"
            accessibilityLabel={`Open live session for ${item.identifier}`}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{
              backgroundColor: colors.primary + "25",
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Text className="text-xs font-semibold text-primary">Live</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onRun(item.id)}
            disabled={isDispatching}
            accessibilityRole="button"
            accessibilityLabel={`Run ${item.identifier}`}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{
              backgroundColor: colors.primary,
              opacity: isDispatching ? 0.65 : 1,
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Text className="text-xs font-semibold text-background">
              {isDispatching ? "Starting" : "Run"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ItemsTab({
  selectedWorkItemId,
  onSelectWorkItem,
  onOpenSession,
  onRefresh,
}: {
  selectedWorkItemId: string | null;
  onSelectWorkItem: (id: string) => void;
  onOpenSession?: (id: string) => void;
  onRefresh?: () => void;
}) {
  const queryClient = useQueryClient();
  const { workspace: primaryWorkspace } = useSelectedWorkspace();
  const listInput = { workspaceId: primaryWorkspace?.id ?? "", limit: 30 };

  const workItemsQuery = useQuery(trpc.workItem.list.queryOptions(
    listInput,
    getTabletRailWorkItemQueryOptions(Boolean(primaryWorkspace?.id)),
  ));

  const reorderMutation = useMutation(
    trpc.workItems.reorderQueue.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
        onRefresh?.();
      },
    }),
  );

  const dispatchMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.list.queryKey(listInput),
        });
        onRefresh?.();
        if (typeof result.sessionId === "string") {
          onOpenSession?.(result.sessionId);
        }
      },
    }),
  );

  const workItemRows = (workItemsQuery.data ?? []) as unknown as TabletQueueItem[];
  const items = buildExecutionQueue(workItemRows);
  const queueItems = buildPriorityQueueItems(workItemRows);

  const handleMove = (itemId: string, direction: QueueMoveDirection) => {
    if (!primaryWorkspace?.id) return;

    const workItemIds = moveQueueItem(
      buildPriorityQueueSaveOrder(queueItems),
      itemId,
      direction,
      queueItems,
    );

    if (workItemIds.join("|") === buildPriorityQueueSaveOrder(queueItems).join("|")) {
      return;
    }

    reorderMutation.mutate({
      workspaceId: primaryWorkspace.id,
      workItemIds,
    });
  };

  const handleSaveQueue = () => {
    if (!primaryWorkspace?.id) return;

    reorderMutation.mutate({
      workspaceId: primaryWorkspace.id,
      workItemIds: buildPriorityQueueSaveOrder(queueItems),
    });
  };

  const handleSortByPriority = () => {
    if (!primaryWorkspace?.id) return;

    const workItemIds = buildPriorityQueueSaveOrder(sortQueueItemsByPriority(queueItems));
    if (workItemIds.join("|") === buildPriorityQueueSaveOrder(queueItems).join("|")) {
      return;
    }

    reorderMutation.mutate({
      workspaceId: primaryWorkspace.id,
      workItemIds,
    });
  };
  const queueControls = buildPriorityQueueControls({
    itemCount: queueItems.length,
    isSaving: reorderMutation.isPending,
  });

  if (workItemsQuery.fetchStatus === "fetching" && items.length === 0) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  const renderRows = (rowItems: TabletQueueItem[]) =>
    rowItems.map((item) => {
      return (
        <WorkItemRow
          key={item.id}
          item={item}
          isSelected={item.id === selectedWorkItemId}
          onPress={() => onSelectWorkItem(item.id)}
          onMove={handleMove}
          canMoveUp={canMoveQueueItem(rowItems, item.id, "up")}
          canMoveDown={canMoveQueueItem(rowItems, item.id, "down")}
          onRun={(workItemId) => dispatchMutation.mutate({ workItemId })}
          onOpenSession={onOpenSession}
          isReordering={reorderMutation.isPending}
          isDispatching={dispatchMutation.isPending}
        />
      );
    });

  return (
    <ScrollView className="flex-1">
      {queueItems.length === 0 ? (
        <View className="items-center justify-center px-4 py-12">
          <Text className="text-sm text-muted">No queued work items</Text>
        </View>
      ) : (
        <View>
          <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted">Priority Order</Text>
              <Text className="mt-0.5 text-[10px] text-muted">
                {reorderMutation.isPending ? "Saving queue..." : "Queue saved"}
              </Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={handleSaveQueue}
                disabled={queueControls[0]?.disabled ?? true}
                accessibilityRole="button"
                accessibilityLabel="Save priority queue"
                className="rounded-md px-2.5 py-1.5 active:opacity-70"
                style={{
                  backgroundColor: colors.primary,
                  opacity: queueControls[0]?.disabled ? 0.55 : 1,
                }}
              >
                <Text className="text-xs font-semibold text-background">
                  {queueControls[0]?.label ?? "Save queue"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSortByPriority}
                disabled={queueControls[1]?.disabled ?? true}
                accessibilityRole="button"
                accessibilityLabel="Sort queue by priority and save"
                className="rounded-md px-2.5 py-1.5 active:opacity-70"
                style={{
                  backgroundColor: colors.secondary,
                  opacity: queueControls[1]?.disabled ? 0.55 : 1,
                }}
              >
                <Text className="text-xs font-medium text-foreground">
                  {queueControls[1]?.label ?? "Sort priority"}
                </Text>
              </Pressable>
              <Text className="text-xs text-muted">{queueItems.length} queued</Text>
            </View>
          </View>
          {renderRows(queueItems)}
        </View>
      )}
    </ScrollView>
  );
}

function PlanningRecentTab({
  sessions,
  connectionState,
  selectedSessionId,
  onOpenPlanningSession,
  onRefresh,
}: {
  sessions: GatewaySession[];
  connectionState: ConnectionState;
  selectedSessionId: string | null;
  onOpenPlanningSession: (id: string) => void;
  onRefresh?: () => void;
}) {
  return (
    <AgentsTab
      sessions={sessions}
      connectionState={connectionState}
      selectedSessionId={selectedSessionId}
      onSelectSession={onOpenPlanningSession}
      onRefresh={onRefresh}
    />
  );
}

function RecentOutcomeRailRow({
  row,
  isSelected,
  onPress,
}: {
  row: TabletRecentOutcomeRailRow;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      accessibilityState={{ selected: isSelected }}
      className="flex-row items-center px-4 py-3 active:opacity-70"
      style={{
        minHeight: 44,
        backgroundColor: isSelected ? colors.cardElevated : "transparent",
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: STATUS_TONE_COLORS[row.statusTone],
          marginRight: 12,
        }}
      />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {row.title}
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          <Text className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted" style={{ backgroundColor: colors.secondary }}>
            {row.statusLabel}
          </Text>
          <Text className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted" numberOfLines={1} style={{ backgroundColor: colors.secondary, maxWidth: 96 }}>
            {row.agentLabel}
          </Text>
          <Text className="text-xs text-muted" numberOfLines={1}>
            {row.lastUpdatedLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function RecentOutcomeItemsTab({
  sessions,
  selectedWorkItemId,
  selectedSessionId,
  onSelectWorkItem,
  onSelectSession,
}: {
  sessions: GatewaySession[];
  selectedWorkItemId: string | null;
  selectedSessionId: string | null;
  onSelectWorkItem: (id: string, view?: MobileWorkItemEntryView) => void;
  onSelectSession: (id: string) => void;
}) {
  const { workspace: primaryWorkspace } = useSelectedWorkspace();
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "", limit: 100 },
      getTabletRailWorkItemQueryOptions(Boolean(primaryWorkspace?.id)),
    ),
  );
  const rows = buildRecentOutcomeRailRows({
    workItems: workItemsQuery.data ?? [],
    sessions,
  });

  if (workItemsQuery.fetchStatus === "fetching" && rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      {rows.length === 0 ? (
        <View className="items-center justify-center px-4 py-12">
          <Text className="text-sm text-muted">No recent outcomes</Text>
        </View>
      ) : (
        <View>
          <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Recent Outcomes</Text>
          {rows.map((row) => (
            <RecentOutcomeRailRow
              key={row.id}
              row={row}
              isSelected={
                row.target.type === "work-item"
                  ? row.target.workItemId === selectedWorkItemId
                  : row.target.type === "execution-session" &&
                    row.target.sessionId === selectedSessionId
              }
              onPress={() => {
                if (row.target.type === "work-item") {
                  onSelectWorkItem(row.target.workItemId, row.entryView ?? "outcome");
                  return;
                }
                if (row.target.type === "execution-session") {
                  onSelectSession(row.target.sessionId);
                }
              }}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ProjectsTab({
  onSelectProject,
}: {
  onSelectProject?: (id: string) => void;
}) {
  const { workspace: primaryWorkspace } = useSelectedWorkspace();
  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "" },
      getTabletRailProjectQueryOptions(Boolean(primaryWorkspace?.id)),
    ),
  );
  const projects =
    (projectsQuery.data ?? []) as unknown as MobileProjectStatusEntry[];
  const rows = buildMobileProjectRailRows({
    workspaceName: primaryWorkspace?.name,
    projects,
  });

  if (projectsQuery.fetchStatus === "fetching" && rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      {rows.length === 0 ? (
        <View className="items-center justify-center px-4 py-12">
          <Text className="text-sm text-muted">No projects yet</Text>
        </View>
      ) : (
        <View>
          <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Projects</Text>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => {
                hapticLight();
                onSelectProject?.(row.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={row.accessibilityLabel}
              className="px-4 py-3 active:opacity-70"
              style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
            >
              <View className="flex-row items-center">
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: STATUS_TONE_COLORS[row.statusTone],
                    marginRight: 12,
                  }}
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                    {row.title}
                  </Text>
                  <View className="mt-1 flex-row items-center gap-2">
                    <Text
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        color: STATUS_TONE_COLORS[row.statusTone],
                        backgroundColor: `${STATUS_TONE_COLORS[row.statusTone]}20`,
                      }}
                    >
                      {row.statusLabel}
                    </Text>
                    <Text
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-muted"
                      numberOfLines={1}
                      style={{ backgroundColor: colors.secondary, maxWidth: 110 }}
                    >
                      {row.detailLabel}
                    </Text>
                    <Text className="text-xs text-muted" numberOfLines={1}>
                      {row.lastUpdatedLabel}
                    </Text>
                  </View>
                  <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
                    {row.activityLabel}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface TabletSidebarProps {
  mode: TabletShellMode;
  leftTab: TabletLeftRailTab;
  sessions: GatewaySession[];
  connectionState: ConnectionState;
  selectedSessionId: string | null;
  selectedWorkItemId: string | null;
  onModeChange: (mode: TabletShellMode) => void;
  onLeftTabChange: (tab: TabletLeftRailTab) => void;
  onSelectSession: (id: string) => void;
  onSelectWorkItem: (id: string, view?: MobileWorkItemEntryView) => void;
  onOpenPlanningSession?: (id: string) => void;
  onSelectProject?: (id: string) => void;
  onOpenSession?: (id: string) => void;
  onRefresh?: () => void;
}

export function TabletSidebar({
  mode,
  leftTab,
  sessions,
  connectionState,
  selectedSessionId,
  selectedWorkItemId,
  onModeChange,
  onLeftTabChange,
  onSelectSession,
  onSelectWorkItem,
  onOpenPlanningSession,
  onSelectProject,
  onOpenSession,
  onRefresh,
}: TabletSidebarProps) {
  const { workspace: primaryWorkspace } = useSelectedWorkspace();
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "", limit: 100 },
      getTabletRailWorkItemQueryOptions(Boolean(primaryWorkspace?.id)),
    ),
  );
  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "" },
      getTabletRailProjectQueryOptions(Boolean(primaryWorkspace?.id)),
    ),
  );
  const handleOpenSession = (id: string) => {
    onOpenSession?.(id);
  };
  const groupedSessions = groupShellSessions(sessions);
  const headerTitle = getShellHeaderTitle();
  const recentSessions =
    mode === "tasks" ? groupedSessions.recentOutcomes : groupedSessions.recentPlanning;
  const leftRailBadges = buildLeftRailTabBadges({
    sessions,
    workItems: workItemsQuery.data ?? [],
    projects: ((projectsQuery.data ?? []) as unknown as { project?: { id?: string } | null }[])
      .flatMap((entry) => entry.project?.id ? [{ id: entry.project.id }] : []),
  });

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View className="flex-row items-start justify-between">
          <View className="flex-1" style={{ minWidth: 0 }}>
            {headerTitle ? (
              <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
                {headerTitle}
              </Text>
            ) : null}
            <View className="mt-1 flex-row items-center">
              <View
                style={{
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor:
                    connectionState === "connected" ? colors.success
                    : connectionState === "reconnecting" || connectionState === "connecting" ? colors.warning
                    : colors.danger,
                  marginRight: 6,
                }}
              />
              <Text className="text-xs text-muted" numberOfLines={1}>
                {getShellHeaderStatusLabel({
                  workspaceName: primaryWorkspace?.name,
                  connectionState,
                  sessionCount: sessions.length,
                })}
              </Text>
            </View>
          </View>
        </View>
        <View className="mt-3">
          <ModeSwitch mode={mode} onModeChange={onModeChange} />
        </View>
      </View>

      <TabBar
        mode={mode}
        tab={leftTab}
        badges={leftRailBadges}
        onTabChange={onLeftTabChange}
      />

      {mode === "tasks" && leftTab === "recent-outcomes" ? (
        <RecentOutcomeItemsTab
          sessions={recentSessions}
          selectedWorkItemId={selectedWorkItemId}
          selectedSessionId={selectedSessionId}
          onSelectWorkItem={onSelectWorkItem}
          onSelectSession={onSelectSession}
        />
      ) : null}
      {mode === "tasks" && leftTab === "priority-queue" ? (
        <ItemsTab
          selectedWorkItemId={selectedWorkItemId}
          onSelectWorkItem={onSelectWorkItem}
          onOpenSession={handleOpenSession}
          onRefresh={onRefresh}
        />
      ) : null}
      {mode === "planning" && leftTab === "recent-sessions" ? (
        <PlanningRecentTab
          sessions={recentSessions}
          connectionState={connectionState}
          selectedSessionId={selectedSessionId}
          onOpenPlanningSession={onOpenPlanningSession ?? onSelectSession}
          onRefresh={onRefresh}
        />
      ) : null}
      {mode === "planning" && leftTab === "projects" ? (
        <ProjectsTab onSelectProject={onSelectProject} />
      ) : null}
    </View>
  );
}
