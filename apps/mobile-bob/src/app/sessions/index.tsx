import { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { router, Stack } from "expo-router";

import type { SessionSummaryTone } from "~/features/sessions/session-summary-model";
import { Badge, Card, EmptyState, ListRow, Screen } from "~/components/ui";
import { buildSessionList } from "~/features/sessions/session-list-model";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";

/**
 * Every execution session in the workspace, on the phone.
 *
 * Grouped by what a person needs to do: sessions paused on a decision first,
 * then the ones running, then what finished recently. Each row opens the
 * session's summary. Live from the gateway's workspace snapshot, so a session
 * that blocks while this screen is open moves up on its own.
 */

const BADGE: Record<
  SessionSummaryTone,
  "default" | "success" | "warning" | "danger" | "accent"
> = {
  running: "accent",
  attention: "warning",
  success: "success",
  failure: "danger",
  idle: "default",
};

export default function SessionsScreen() {
  const { sessions, connectionState, refresh } = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();

  const list = useMemo(
    () => buildSessionList(sessions, { workspaceId: selectedWorkspaceId }),
    [sessions, selectedWorkspaceId],
  );

  const isConnecting = connectionState !== "connected";

  return (
    <>
      <Stack.Screen options={{ title: "Sessions" }} />
      <Screen>
        <ScrollView
          contentContainerClassName="pb-12"
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refresh} />
          }
        >
          {isConnecting ? (
            <Text
              className="text-muted mb-3 text-xs"
              style={{ color: colors.muted }}
            >
              {connectionState === "connecting" ||
              connectionState === "reconnecting"
                ? "Connecting to the gateway…"
                : "Not connected to the gateway; showing what was last received."}
            </Text>
          ) : null}

          {list.isEmpty ? (
            <EmptyState
              icon="○"
              title={isConnecting ? "Waiting for sessions" : "No sessions yet"}
              hint="Dispatch a work item and its session will appear here."
            />
          ) : (
            list.sections.map((section) => (
              <View key={section.key} className="mb-5">
                <View className="mb-2 flex-row items-baseline justify-between">
                  <Text className="text-foreground text-base font-semibold">
                    {section.title}
                  </Text>
                  <Text className="text-muted text-xs">
                    {section.rows.length < section.total
                      ? `${section.rows.length} of ${section.total}`
                      : String(section.total)}
                  </Text>
                </View>
                <Card>
                  {section.rows.map((row, index) => (
                    <ListRow
                      key={row.sessionId}
                      title={row.title}
                      subtitle={[
                        row.identifier,
                        row.agentLabel,
                        row.lastActivityLabel,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      showDivider={index < section.rows.length - 1}
                      onPress={() => router.push(row.href)}
                      right={
                        <Badge variant={BADGE[row.tone]}>
                          {row.statusLabel}
                        </Badge>
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
