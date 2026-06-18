import { useState } from "react";
import { Text, View, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { GatewaySession } from "~/hooks/use-gateway";
import type { ConnectionState } from "@bob/ws";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { hapticLight, hapticSelection } from "~/lib/haptics";
import {
  buildExecutionQueue,
  buildQueueLanes,
  formatStatusLabel,
  moveQueueItem,
} from "~/features/tablet/queue";
import type {
  QueueMoveDirection,
  TabletQueueItem,
} from "~/features/tablet/queue";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type SidebarTab = "agents" | "queue";

function TabBar({ tab, onTabChange }: { tab: SidebarTab; onTabChange: (t: SidebarTab) => void }) {
  return (
    <View
      className="flex-row"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      {(["agents", "queue"] as const).map((t) => (
        <Pressable
          key={t}
          onPress={() => { hapticSelection(); onTabChange(t); }}
          className="flex-1 items-center py-2.5 active:opacity-70"
          style={{
            borderBottomWidth: 2,
            borderBottomColor: tab === t ? colors.primary : "transparent",
          }}
        >
          <Text
            className="text-sm font-medium"
            style={{ color: tab === t ? colors.foreground : colors.muted }}
          >
            {t === "agents" ? "Active Agents" : "Work Queue"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "running" | "completed" | "failed";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "completed", label: "Done" },
  { key: "failed", label: "Failed" },
];

function matchesFilter(status: string, filter: StatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "running": return status === "running" || status === "starting" || status === "provisioning";
    case "completed": return status === "stopped" || status === "idle";
    case "failed": return status === "error";
  }
}

const STATUS_COLORS: Record<string, string> = {
  running: colors.success,
  starting: colors.warning,
  provisioning: colors.warning,
  idle: colors.muted,
  stopping: colors.muted2,
  stopped: colors.muted2,
  error: colors.danger,
};

function SessionRow({
  session,
  isSelected,
  onPress,
}: {
  session: GatewaySession;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${session.title ?? session.agentType}, ${session.status}`}
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
          backgroundColor: STATUS_COLORS[session.status] ?? colors.muted,
          marginRight: 12,
        }}
      />
      <View className="flex-1">
        <Text
          className="text-sm font-medium text-foreground"
          numberOfLines={1}
        >
          {session.title ?? session.agentType}
        </Text>
        <Text className="text-xs text-muted">
          {session.status}
        </Text>
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
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const filtered = filter === "all" ? sessions : sessions.filter((s) => matchesFilter(s.status, filter));
  const active = filtered.filter(
    (s) => s.status === "running" || s.status === "starting" || s.status === "provisioning",
  );
  const inactive = filtered.filter(
    (s) => s.status !== "running" && s.status !== "starting" && s.status !== "provisioning",
  );

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
        {filtered.length === 0 ? (
          <View className="items-center justify-center px-4 py-12">
            <Text className="text-sm text-muted">
              {connectionState === "connected" ? "No agent sessions" : "Connecting..."}
            </Text>
          </View>
        ) : (
          <>
            {active.length > 0 && (
              <View>
                <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Running Now</Text>
                {active.map((s) => (
                  <SessionRow key={s.sessionId} session={s} isSelected={s.sessionId === selectedSessionId} onPress={() => onSelectSession(s.sessionId)} />
                ))}
              </View>
            )}
            {inactive.length > 0 && (
              <View>
                <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">History</Text>
                {inactive.map((s) => (
                  <SessionRow key={s.sessionId} session={s} isSelected={s.sessionId === selectedSessionId} onPress={() => onSelectSession(s.sessionId)} />
                ))}
              </View>
            )}
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
  index,
  total,
  isSelected,
  onPress,
  onMove,
  onRun,
  onOpenSession,
  isReordering,
  isDispatching,
}: {
  item: TabletQueueItem;
  index: number;
  total: number;
  isSelected: boolean;
  onPress: () => void;
  onMove: (itemId: string, direction: QueueMoveDirection) => void;
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
          disabled={index === 0 || isReordering}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.identifier} up`}
          className="mr-2 rounded-md px-2.5 py-1.5 active:opacity-70"
          style={{
            backgroundColor: colors.secondary,
            opacity: index === 0 || isReordering ? 0.45 : 1,
            minHeight: 32,
            justifyContent: "center",
          }}
        >
          <Text className="text-xs font-medium text-foreground">Up</Text>
        </Pressable>
        <Pressable
          onPress={() => onMove(item.id, "down")}
          disabled={index === total - 1 || isReordering}
          accessibilityRole="button"
          accessibilityLabel={`Move ${item.identifier} down`}
          className="mr-2 rounded-md px-2.5 py-1.5 active:opacity-70"
          style={{
            backgroundColor: colors.secondary,
            opacity: index === total - 1 || isReordering ? 0.45 : 1,
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
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const workspacesQuery = useQuery(trpc.workspace.list.queryOptions(undefined, { enabled: Boolean(session) }));
  const primaryWorkspace = (workspacesQuery.data as { workspace: { id: string; name: string } }[] | undefined)?.[0]?.workspace ?? null;
  const listInput = { workspaceId: primaryWorkspace?.id ?? "", limit: 30 };

  const workItemsQuery = useQuery(trpc.workItem.list.queryOptions(
    listInput,
    { enabled: Boolean(primaryWorkspace?.id) },
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

  const items = buildExecutionQueue((workItemsQuery.data ?? []) as TabletQueueItem[]);
  const lanes = buildQueueLanes(items);

  const handleMove = (itemId: string, direction: QueueMoveDirection) => {
    if (!primaryWorkspace?.id) return;

    const workItemIds = moveQueueItem(
      items.map((item) => item.id),
      itemId,
      direction,
    );

    if (workItemIds.join("|") === items.map((item) => item.id).join("|")) {
      return;
    }

    reorderMutation.mutate({
      workspaceId: primaryWorkspace.id,
      workItemIds,
    });
  };

  if (workItemsQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  const renderRows = (laneItems: TabletQueueItem[]) =>
    laneItems.map((item) => {
      const queueIndex = items.findIndex((candidate) => candidate.id === item.id);

      return (
        <WorkItemRow
          key={item.id}
          item={item}
          index={queueIndex}
          total={items.length}
          isSelected={item.id === selectedWorkItemId}
          onPress={() => onSelectWorkItem(item.id)}
          onMove={handleMove}
          onRun={(workItemId) => dispatchMutation.mutate({ workItemId })}
          onOpenSession={onOpenSession}
          isReordering={reorderMutation.isPending}
          isDispatching={dispatchMutation.isPending}
        />
      );
    });

  return (
    <ScrollView className="flex-1">
      {items.length === 0 ? (
        <View className="items-center justify-center px-4 py-12">
          <Text className="text-sm text-muted">No queued work items</Text>
        </View>
      ) : (
        <>
          {lanes.active.length > 0 ? (
            <View>
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Moved to Active Agents</Text>
              {renderRows(lanes.active)}
            </View>
          ) : null}
          {lanes.queued.length > 0 ? (
            <View>
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Ready to Start</Text>
              {renderRows(lanes.queued)}
            </View>
          ) : null}
          {lanes.review.length > 0 ? (
            <View>
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Review & Blockers</Text>
              {renderRows(lanes.review)}
            </View>
          ) : null}
          {lanes.done.length > 0 ? (
            <View>
              <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">Done</Text>
              {renderRows(lanes.done)}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export interface TabletSidebarProps {
  sessions: GatewaySession[];
  connectionState: ConnectionState;
  selectedSessionId: string | null;
  selectedWorkItemId: string | null;
  onSelectSession: (id: string) => void;
  onSelectWorkItem: (id: string) => void;
  onOpenSession?: (id: string) => void;
  onOpenDashboard: () => void;
  onRefresh?: () => void;
}

export function TabletSidebar({
  sessions,
  connectionState,
  selectedSessionId,
  selectedWorkItemId,
  onSelectSession,
  onSelectWorkItem,
  onOpenSession,
  onOpenDashboard,
  onRefresh,
}: TabletSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("agents");
  const handleOpenSession = (id: string) => {
    setTab("agents");
    onOpenSession?.(id);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View className="flex-row items-start justify-between">
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
              Mission Control
            </Text>
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
                {connectionState === "connected"
                  ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
                  : connectionState}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => { hapticSelection(); onOpenDashboard(); }}
            accessibilityRole="button"
            accessibilityLabel="Back to dashboard"
            className="ml-3 rounded-md px-3 py-1.5 active:opacity-70"
            style={{
              backgroundColor: colors.primary + "25",
              minHeight: 36,
              justifyContent: "center",
            }}
          >
            <Text className="text-xs font-semibold text-primary">
              Dashboard
            </Text>
          </Pressable>
        </View>
      </View>

      <TabBar tab={tab} onTabChange={setTab} />

      {tab === "agents" ? (
        <AgentsTab
          sessions={sessions}
          connectionState={connectionState}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          onRefresh={onRefresh}
        />
      ) : (
        <ItemsTab
          selectedWorkItemId={selectedWorkItemId}
          onSelectWorkItem={onSelectWorkItem}
          onOpenSession={handleOpenSession}
          onRefresh={onRefresh}
        />
      )}
    </View>
  );
}
