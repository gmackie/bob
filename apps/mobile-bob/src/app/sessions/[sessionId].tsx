import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AgentThreadView } from "~/components/tablet/AgentThreadView";
import { Screen } from "~/components/ui";
import {
  getMobileDetailBackAction,
  getMobileTasksDashboardHref,
} from "~/features/tablet/navigation";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { authClient } from "~/utils/auth";

export default function ExecutionSessionScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const gateway = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const { selectSession, selectedSessionEvents, sendInput, stopSession } = gateway;

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
    return () => selectSession(null);
  }, [selectSession, sessionId]);

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

  if (!sessionId) {
    return <Redirect href={getMobileTasksDashboardHref(selectedWorkspaceId) as never} />;
  }

  const backAction = getMobileDetailBackAction({
    source: "execution-session",
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
            Session Output
          </Text>
          <Text className="mt-1 text-sm font-semibold text-foreground" numberOfLines={1}>
            {sessionId}
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
      <AgentThreadView
        sessionId={sessionId}
        events={selectedSessionEvents}
        onSendInput={sendInput}
        onStopSession={stopSession}
      />
    </View>
  );
}
