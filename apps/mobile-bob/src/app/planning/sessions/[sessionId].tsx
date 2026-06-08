import { useEffect } from "react";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { PlanningPane } from "~/components/tablet/PlanningPane";
import { Screen } from "~/components/ui";
import {
  getMobileDetailBackAction,
  getMobilePlanningDashboardHref,
} from "~/features/tablet/navigation";
import { getPlanningPaneSession } from "~/features/tablet/shell";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";

function getRouteSessionId(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

export default function PlanningSessionScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = getRouteSessionId(params.sessionId);
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const {
    sessions,
    selectedSessionEvents,
    sendInput,
    stopSession,
    openPlanningSession,
  } = useGateway();

  useEffect(() => {
    if (!sessionId || !session) return;
    openPlanningSession(sessionId);
  }, [openPlanningSession, session, sessionId]);

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  if (!sessionId) {
    return <Redirect href={getMobilePlanningDashboardHref(selectedWorkspaceId) as never} />;
  }

  const planningSession = getPlanningPaneSession(sessions, sessionId);
  const backAction = getMobileDetailBackAction({
    source: "planning-session",
    workspaceId: selectedWorkspaceId,
  });

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View className="min-w-0 flex-1 pr-4">
          <Text className="text-xs uppercase tracking-[0.18em] text-muted">
            Planning Session
          </Text>
          <Text className="mt-1 text-sm font-semibold text-foreground" numberOfLines={1}>
            {planningSession.title || planningSession.sessionId}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backAction.accessibilityLabel}
          onPress={() => router.replace(backAction.href as never)}
          className="rounded-md px-3 py-2 active:opacity-70"
          style={{ backgroundColor: colors.secondary }}
        >
          <Text className="text-sm font-semibold text-foreground">{backAction.label}</Text>
        </Pressable>
      </View>
      <PlanningPane
        sessionId={planningSession.sessionId}
        sessionStatus={planningSession.status}
        sessionType={planningSession.sessionType}
        workItemTitle={planningSession.title}
        events={selectedSessionEvents}
        onSendInput={sendInput}
        onStopSession={stopSession}
      />
    </View>
  );
}
