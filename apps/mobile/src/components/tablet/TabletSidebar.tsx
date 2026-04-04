import { Text, View, Pressable, ScrollView } from "react-native";

import type { GatewaySession } from "~/hooks/use-gateway";
import type { ConnectionState } from "@bob/ws";
import { colors } from "~/lib/colors";

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
}

export function TabletSidebar({
  sessions,
  connectionState,
  selectedSessionId,
  onSelectSession,
}: TabletSidebarProps) {
  const activeSessions = sessions.filter(
    (s) => s.status === "running" || s.status === "starting" || s.status === "provisioning",
  );
  const inactiveSessions = sessions.filter(
    (s) => s.status !== "running" && s.status !== "starting" && s.status !== "provisioning",
  );

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

      {/* Session list */}
      <ScrollView className="flex-1">
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
