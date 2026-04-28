import { useState } from "react";
import { Text, View, Pressable, ScrollView, RefreshControl, ActivityIndicator } from "react-native";
import { useQuery } from "@tanstack/react-query";

import type { GatewaySession } from "~/hooks/use-gateway";
import type { ConnectionState } from "@bob/ws";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { hapticLight, hapticSelection } from "~/lib/haptics";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

type SidebarTab = "agents" | "items";

function TabBar({ tab, onTabChange }: { tab: SidebarTab; onTabChange: (t: SidebarTab) => void }) {
  return (
    <View
      className="flex-row"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      {(["agents", "items"] as const).map((t) => (
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
            {t === "agents" ? "Agents" : "Items"}
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
          className="text-sm font-medium"
          style={{ color: colors.foreground }}
          numberOfLines={1}
        >
          {session.title ?? session.agentType}
        </Text>
        <Text className="text-xs" style={{ color: colors.muted }}>
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
            <Text className="text-sm" style={{ color: colors.muted }}>
              {connectionState === "connected" ? "No agent sessions" : "Connecting..."}
            </Text>
          </View>
        ) : (
          <>
            {active.length > 0 && (
              <View>
                <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>Active</Text>
                {active.map((s) => (
                  <SessionRow key={s.sessionId} session={s} isSelected={s.sessionId === selectedSessionId} onPress={() => onSelectSession(s.sessionId)} />
                ))}
              </View>
            )}
            {inactive.length > 0 && (
              <View>
                <Text className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider" style={{ color: colors.muted }}>Recent</Text>
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
  isSelected,
  onPress,
}: {
  item: { id: string; identifier: string; title: string; kind: string; status: string };
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${item.identifier} ${item.title}, ${item.status}`}
      accessibilityState={{ selected: isSelected }}
      className="flex-row items-center px-4 py-3 active:opacity-70"
      style={{
        minHeight: 44,
        backgroundColor: isSelected ? colors.cardElevated : "transparent",
      }}
    >
      <View
        className="mr-3 items-center justify-center rounded"
        style={{
          width: 24,
          height: 24,
          backgroundColor: colors.primary + "25",
        }}
      >
        <Text className="text-xs font-bold" style={{ color: colors.primary }}>
          {KIND_ICONS[item.kind] ?? item.kind[0]?.toUpperCase()}
        </Text>
      </View>
      <View className="flex-1">
        <Text
          className="text-sm font-medium"
          style={{ color: colors.foreground }}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <Text className="text-xs" style={{ color: colors.muted }}>
          {item.identifier} · {item.status.replace(/_/g, " ")}
        </Text>
      </View>
    </Pressable>
  );
}

function ItemsTab({
  selectedWorkItemId,
  onSelectWorkItem,
}: {
  selectedWorkItemId: string | null;
  onSelectWorkItem: (id: string) => void;
}) {
  const { data: session } = authClient.useSession();
  const workspacesQuery = useQuery(trpc.workspace.list.queryOptions(undefined, { enabled: Boolean(session) }));
  const primaryWorkspace = (workspacesQuery.data as Array<{ workspace: { id: string; name: string } }> | undefined)?.[0]?.workspace ?? null;

  const workItemsQuery = useQuery(trpc.workItem.list.queryOptions(
    { workspaceId: primaryWorkspace?.id ?? "", limit: 30 },
    { enabled: Boolean(primaryWorkspace?.id) },
  ));

  const items = (workItemsQuery.data ?? []) as Array<{ id: string; identifier: string; title: string; kind: string; status: string }>;

  if (workItemsQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-12">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1">
      {items.length === 0 ? (
        <View className="items-center justify-center px-4 py-12">
          <Text className="text-sm" style={{ color: colors.muted }}>No work items</Text>
        </View>
      ) : (
        items.map((item) => (
          <WorkItemRow
            key={item.id}
            item={item}
            isSelected={item.id === selectedWorkItemId}
            onPress={() => onSelectWorkItem(item.id)}
          />
        ))
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
  onRefresh?: () => void;
}

export function TabletSidebar({
  sessions,
  connectionState,
  selectedSessionId,
  selectedWorkItemId,
  onSelectSession,
  onSelectWorkItem,
  onRefresh,
}: TabletSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("agents");

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View className="px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
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
          <Text className="text-xs" style={{ color: colors.muted }}>
            {connectionState === "connected"
              ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
              : connectionState}
          </Text>
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
        />
      )}
    </View>
  );
}
