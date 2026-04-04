import { useState } from "react";
import { Text, View, Pressable, ScrollView, RefreshControl } from "react-native";

import type { GatewaySession } from "~/hooks/use-gateway";
import type { ConnectionState } from "@bob/ws";
import { colors } from "~/lib/colors";

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
      onPress={onPress}
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

interface TabletSidebarProps {
  sessions: GatewaySession[];
  connectionState: ConnectionState;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onRefresh?: () => void;
}

export function TabletSidebar({
  sessions,
  connectionState,
  selectedSessionId,
  onSelectSession,
  onRefresh,
}: TabletSidebarProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const filtered = filter === "all" ? sessions : sessions.filter((s) => matchesFilter(s.status, filter));
  const activeSessions = filtered.filter(
    (s) => s.status === "running" || s.status === "starting" || s.status === "provisioning",
  );
  const inactiveSessions = filtered.filter(
    (s) => s.status !== "running" && s.status !== "starting" && s.status !== "provisioning",
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    onRefresh?.();
    // Give the snapshot time to arrive
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View
        className="px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Text
          className="text-lg font-semibold"
          style={{ color: colors.foreground }}
        >
          Mission Control
        </Text>
        <View className="mt-1 flex-row items-center">
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                connectionState === "connected"
                  ? colors.success
                  : connectionState === "reconnecting" || connectionState === "connecting"
                    ? colors.warning
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

      {/* Filter chips */}
      <View
        className="flex-row px-3 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            className="mr-1.5 rounded-full px-3 py-1 active:opacity-70"
            style={{
              backgroundColor: filter === f.key ? colors.primary + "30" : colors.secondary,
              minHeight: 32,
              justifyContent: "center",
            }}
          >
            <Text
              className="text-xs font-medium"
              style={{
                color: filter === f.key ? colors.primary : colors.muted,
              }}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Session list */}
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.muted}
          />
        }
      >
        {sessions.length === 0 ? (
          <View className="items-center justify-center px-4 py-12">
            <Text className="text-sm" style={{ color: colors.muted }}>
              {connectionState === "connected"
                ? "No agent sessions"
                : "Connecting..."}
            </Text>
            {connectionState === "connected" && (
              <Text
                className="mt-1 text-center text-xs"
                style={{ color: colors.muted2 }}
              >
                Sessions will appear here when agents are running
              </Text>
            )}
          </View>
        ) : (
          <>
            {activeSessions.length > 0 && (
              <View>
                <Text
                  className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: colors.muted }}
                >
                  Active
                </Text>
                {activeSessions.map((session) => (
                  <SessionRow
                    key={session.sessionId}
                    session={session}
                    isSelected={session.sessionId === selectedSessionId}
                    onPress={() => onSelectSession(session.sessionId)}
                  />
                ))}
              </View>
            )}
            {inactiveSessions.length > 0 && (
              <View>
                <Text
                  className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: colors.muted }}
                >
                  Recent
                </Text>
                {inactiveSessions.map((session) => (
                  <SessionRow
                    key={session.sessionId}
                    session={session}
                    isSelected={session.sessionId === selectedSessionId}
                    onPress={() => onSelectSession(session.sessionId)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
