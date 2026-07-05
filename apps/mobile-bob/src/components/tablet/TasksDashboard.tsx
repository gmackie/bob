import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import type { DimensionValue } from "react-native";
import { useQuery } from "@tanstack/react-query";

import type { GatewaySession } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import {
  buildRunningNowEntries,
  extractProviderCapacitySnapshotsFromRuns,
  buildProviderCapacityCards,
  buildRecentlyCompletedWorkItems,
  buildTaskLaneSummaries,
  getProviderCapacityStatusLine,
  getRecentlyCompletedRowModel,
  getTaskDashboardHeaderModel,
  getTaskDashboardLayout,
} from "~/features/tablet/dashboard";
import {
  getMobileShellGlobalActions,
  getMobileShellModeActions,
} from "~/features/tablet/navigation";
import type {
  DashboardTone,
  ProviderCapacityCard,
  RunningNowEntry,
  TaskLaneKey,
  TaskLaneSummary,
} from "~/features/tablet/dashboard";
import type { TabletQueueItem } from "~/features/tablet/queue";
import { formatStatusLabel } from "~/features/tablet/queue";
import type { ProviderKey } from "~/features/tablet/dashboard";
import type { TabletShellMode, TasksLeftRailTab } from "~/features/tablet/shell";
import type { MobileWorkItemEntryView } from "~/features/tablet/work-item-entry";

function toneColor(tone: DashboardTone) {
  switch (tone) {
    case "danger":
      return colors.danger;
    case "warning":
      return colors.warning;
    case "success":
      return colors.success;
    default:
      return colors.muted;
  }
}

function ProviderCard({
  card,
  onOpenProvider,
  footerDirection,
}: {
  card: ProviderCapacityCard;
  onOpenProvider?: (provider: ProviderKey) => void;
  footerDirection: "row" | "column";
}) {
  const accent = toneColor(card.tone);

  return (
    <Pressable
      onPress={() => onOpenProvider?.(card.provider)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${card.label} provider detail`}
      className="flex-1 rounded-lg border p-4 active:opacity-80"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-foreground">{card.label}</Text>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: accent,
          }}
        />
      </View>
      <View className="mt-4 gap-3">
        {card.usageLimits.map((limit) => {
          const barPercent = limit.barPercent ?? limit.remainingPercent ?? 0;
          const width = `${barPercent}%` as DimensionValue;
          const valueLabel =
            limit.valueLabel ??
            (limit.remainingPercent === null
              ? "Unavailable"
              : `${limit.remainingPercent}% remaining`);

          return (
            <View key={limit.label}>
              <View className="mb-1 flex-row items-center justify-between">
                <Text className="text-xs font-medium text-muted">{limit.label}</Text>
                <Text className="text-xs font-semibold text-foreground">
                  {valueLabel}
                </Text>
              </View>
              <View
                className="h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: colors.secondary }}
              >
                <View
                  className="h-2 rounded-full"
                  style={{ width, backgroundColor: colors.success }}
                />
              </View>
              {limit.resetLabel ? (
                <Text className="mt-1 text-[10px] text-muted2">{limit.resetLabel}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <View
        className={footerDirection === "row" ? "mt-4 flex-row items-center justify-between gap-2" : "mt-4 gap-1"}
      >
        <Text className="text-xs text-muted" numberOfLines={1}>
          {card.activeCount} active · {card.queuedOrStartingCount} queued/starting
        </Text>
        <Text className="text-xs font-medium" style={{ color: accent }} numberOfLines={1}>
          {getProviderCapacityStatusLine(card)}
        </Text>
      </View>
    </Pressable>
  );
}

function LaneCard({
  lane,
  onOpenLane,
  minWidth,
}: {
  lane: TaskLaneSummary;
  onOpenLane?: (lane: TaskLaneKey) => void;
  minWidth: number;
}) {
  const accent = toneColor(lane.tone);

  return (
    <Pressable
      onPress={() => onOpenLane?.(lane.key)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${lane.title} table`}
      className="rounded-lg border px-2.5 py-3 active:opacity-80"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.card,
        flex: 1,
        minWidth,
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text
          className="flex-1 text-xs font-semibold text-foreground"
          numberOfLines={2}
          style={{ lineHeight: 16 }}
        >
          {lane.title}
        </Text>
        <Text className="ml-2 text-lg font-semibold" style={{ color: accent }}>
          {lane.count}
        </Text>
      </View>
    </Pressable>
  );
}

function WorkItemMiniRow({
  item,
  onPress,
  statusLabel,
}: {
  item: TabletQueueItem;
  onPress?: (item: TabletQueueItem) => void;
  statusLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => onPress?.(item)}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Open ${item.identifier} ${item.title}` : undefined}
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
        {item.identifier} · {item.title}
      </Text>
      <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
        {statusLabel ?? formatStatusLabel(item.status)}
      </Text>
    </Pressable>
  );
}

function RunningNowRail({
  entries,
  onOpenWorkItem,
  onOpenSession,
}: {
  entries: RunningNowEntry[];
  onOpenWorkItem?: (workItemId: string, view?: MobileWorkItemEntryView) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  return (
    <View
      testID="tasks-running-now-rail"
      collapsable={false}
      accessible
      accessibilityLabel="Tasks running now rail"
      className="rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Running Now
        </Text>
        <Text className="text-xs font-semibold text-foreground">
          {entries.length}
        </Text>
      </View>
      {entries.length === 0 ? (
        <Text className="text-sm text-muted">
          No execution sessions are currently in progress.
        </Text>
      ) : (
        <View className="gap-2">
          {entries.map((entry) => (
            <RunningNowEntryRow
              key={entry.id}
              entry={entry}
              onPress={() => {
                if (entry.target.type === "work-item") {
                  onOpenWorkItem?.(entry.target.workItemId, entry.target.view);
                  return;
                }
                onOpenSession?.(entry.target.sessionId);
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function RunningNowEntryRow({
  entry,
  onPress,
}: {
  entry: RunningNowEntry;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `Open ${entry.accessibilityLabel}` : undefined}
      className="rounded-lg border px-3 py-2"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
        {entry.title}
      </Text>
      <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
        {entry.statusLabel} · {entry.detailLabel} · {entry.lastUpdatedLabel}
      </Text>
    </Pressable>
  );
}

export function TasksDashboard({
  sessions,
  onOpenProvider,
  onOpenLane,
  onOpenWorkItem,
  onOpenSession,
  onOpenTaskTab,
  onOpenMode,
  onOpenSettings,
}: {
  sessions: GatewaySession[];
  onOpenProvider?: (provider: ProviderKey) => void;
  onOpenLane?: (lane: TaskLaneKey) => void;
  onOpenWorkItem?: (workItemId: string, view?: MobileWorkItemEntryView) => void;
  onOpenSession?: (sessionId: string) => void;
  onOpenTaskTab?: (tab: TasksLeftRailTab) => void;
  onOpenMode?: (mode: TabletShellMode) => void;
  onOpenSettings?: () => void;
}) {
  const { width } = useWindowDimensions();
  const { workspace: primaryWorkspace } = useSelectedWorkspace();
  const workItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "", limit: 80 },
      { enabled: Boolean(primaryWorkspace?.id), refetchInterval: 10_000 },
    ),
  );
  const workItems = useMemo(
    () => ((workItemsQuery.data ?? []) as TabletQueueItem[]),
    [workItemsQuery.data],
  );
  const agentRunsQuery = useQuery(
    trpc.agentRun.list.queryOptions(
      { workspaceId: primaryWorkspace?.id ?? "", limit: 100 },
      { enabled: Boolean(primaryWorkspace?.id), refetchInterval: 10_000 },
    ),
  );
  const capacitySnapshots = useMemo(
    () => extractProviderCapacitySnapshotsFromRuns(
      (agentRunsQuery.data ?? []) as {
        id: string;
        agentType?: string | null;
        summary?: unknown;
      }[],
    ),
    [agentRunsQuery.data],
  );
  const providerCards = useMemo(
    () => buildProviderCapacityCards({ sessions, workItems, capacitySnapshots }),
    [capacitySnapshots, sessions, workItems],
  );
  const lanes = useMemo(
    () => buildTaskLaneSummaries(workItems),
    [workItems],
  );
  const runningNowEntries = useMemo(
    () => buildRunningNowEntries({ workItems, sessions }),
    [sessions, workItems],
  );
  const recentlyCompleted = useMemo(
    () => buildRecentlyCompletedWorkItems(workItems),
    [workItems],
  );
  const dashboardLayout = getTaskDashboardLayout(width);
  const showRightRail = dashboardLayout.showRightRail;
  const [liveRailOpen, setLiveRailOpen] = useState(false);
  const showLiveRailSheet = dashboardLayout.liveRailPresentation === "sheet";
  const header = getTaskDashboardHeaderModel();
  const modeActions = onOpenMode
    ? getMobileShellModeActions("tasks", primaryWorkspace?.id)
    : [];
  const globalActions = onOpenSettings
    ? getMobileShellGlobalActions(primaryWorkspace?.id)
    : [];

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      {modeActions.length > 0 ? (
        <View className="mb-4 flex-row gap-2">
          {modeActions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityState={{ selected: action.isActive }}
              accessibilityLabel={`Open ${action.label}`}
              onPress={() => onOpenMode?.(action.key)}
              className="rounded-md px-3 py-2 active:opacity-80"
              style={{
                backgroundColor: action.isActive ? colors.primary : colors.secondary,
              }}
            >
              <Text
                className="text-xs font-semibold"
                style={{ color: action.isActive ? colors.background : colors.foreground }}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View className="flex-row items-start justify-between">
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            {header.title}
          </Text>
        </View>
        {onOpenTaskTab || globalActions.length > 0 ? (
          <View className="ml-4 flex-row gap-2">
            {globalActions.map((action) => (
              <Pressable
                key={action.key}
                onPress={onOpenSettings}
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel}
                className="rounded-md px-3 py-2 active:opacity-80"
                style={{ backgroundColor: colors.secondary }}
              >
                <Text className="text-xs font-semibold text-foreground">
                  {action.label}
                </Text>
              </Pressable>
            ))}
            {onOpenTaskTab ? (
              <>
                <Pressable
                  onPress={() => onOpenTaskTab("recent-outcomes")}
                  accessibilityRole="button"
                  accessibilityLabel="Open recent outcomes"
                  className="rounded-md px-3 py-2 active:opacity-80"
                  style={{ backgroundColor: colors.secondary }}
                >
                  <Text className="text-xs font-semibold text-foreground">Outcomes</Text>
                </Pressable>
                <Pressable
                  onPress={() => onOpenTaskTab("priority-queue")}
                  accessibilityRole="button"
                  accessibilityLabel="Open priority queue"
                  className="rounded-md px-3 py-2 active:opacity-80"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-xs font-semibold text-background">Queue</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      {showLiveRailSheet ? (
        <Pressable
          onPress={() => setLiveRailOpen((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={liveRailOpen ? "Hide running now" : "Show running now"}
          className="mt-4 rounded-lg border px-4 py-3 active:opacity-80"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-foreground">Running Now</Text>
            <Text className="text-sm font-semibold text-foreground">{runningNowEntries.length}</Text>
          </View>
        </Pressable>
      ) : null}

      {workItemsQuery.isLoading ? (
        <View className="mt-12 items-center justify-center">
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : (
        <View className={showRightRail ? "mt-6 flex-row gap-4" : "mt-6 gap-4"}>
          <View className="min-w-0 flex-1">
            {showLiveRailSheet && liveRailOpen ? (
              <View className="mb-2">
                <RunningNowRail
                  entries={runningNowEntries}
                  onOpenWorkItem={onOpenWorkItem}
                  onOpenSession={onOpenSession}
                />
              </View>
            ) : null}

            <View className="flex-row gap-3">
              {providerCards.map((card) => (
                <ProviderCard
                  key={card.provider}
                  card={card}
                  onOpenProvider={onOpenProvider}
                  footerDirection={dashboardLayout.providerFooterDirection}
                />
              ))}
            </View>

            <View className="mt-6">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Operations
                </Text>
                <Text className="text-xs text-muted">
                  {workItems.length} work items
                </Text>
              </View>
              <View
                className="flex-row gap-3"
                style={{ flexWrap: dashboardLayout.laneWrap }}
              >
                {lanes.map((lane) => (
                  <LaneCard
                    key={lane.key}
                    lane={lane}
                    onOpenLane={onOpenLane}
                    minWidth={dashboardLayout.laneCardMinWidth}
                  />
                ))}
              </View>
            </View>

            <View className="mt-6">
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Recently Completed
                </Text>
                <Text className="text-xs text-muted">
                  {recentlyCompleted.length}
                </Text>
              </View>
              {recentlyCompleted.length === 0 ? (
                <View
                  className="rounded-lg border p-4"
                  style={{ borderColor: colors.border, backgroundColor: colors.card }}
                >
                  <Text className="text-sm text-muted">
                    No recently completed work yet.
                  </Text>
                </View>
              ) : (
                <View className="gap-2">
                  {recentlyCompleted.map((item) => (
                    <WorkItemMiniRow
                      key={item.id}
                      item={item}
                      statusLabel={getRecentlyCompletedRowModel(item).statusLabel}
                      onPress={
                        onOpenWorkItem
                          ? () => onOpenWorkItem(item.id, "outcome")
                          : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          </View>

          {showRightRail ? (
            <View style={{ width: 280 }}>
              <RunningNowRail
                entries={runningNowEntries}
                onOpenWorkItem={onOpenWorkItem}
                onOpenSession={onOpenSession}
              />
            </View>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
