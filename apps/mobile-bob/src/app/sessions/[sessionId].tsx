import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { AgentThreadView } from "~/components/tablet/AgentThreadView";
import { Screen } from "~/components/ui";
import { SessionSummaryView } from "~/features/sessions/SessionSummaryView";
import { useSessionSummary } from "~/features/sessions/use-session-summary";
import { getMobileTasksDashboardHref } from "~/features/tablet/navigation";
import { getMobileOutcomeWorkItemHref } from "~/features/tablet/work-item-entry";
import { useGateway } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import { hapticSelection } from "~/lib/haptics";
import { authClient } from "~/utils/auth";

/**
 * A session on the phone.
 *
 * Opens on the summary: status, what the agent is doing or how it ended, what
 * it is waiting on, the checks, its last message and the moments that
 * mattered. The full event stream is one tap away behind "Thread"; it used to
 * be the only thing here, with the raw session id for a title, so reviewing a
 * run that finished while you were away meant reading it end to end.
 */

type SessionView = "summary" | "thread";

const VIEWS: readonly { key: SessionView; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "thread", label: "Thread" },
];

export default function ExecutionSessionScreen() {
  const { data: authSession, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ sessionId: string; view?: string }>();
  const rawSessionIdParam: unknown = params.sessionId;
  const sessionId = Array.isArray(rawSessionIdParam)
    ? (rawSessionIdParam[0] as string | undefined)
    : (rawSessionIdParam as string | undefined);
  const gateway = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const {
    sessions,
    selectSession,
    selectedSessionEvents,
    sendInput,
    stopSession,
    approve,
    reportRunView,
  } = gateway;
  const [view, setView] = useState<SessionView>(
    params.view === "thread" ? "thread" : "summary",
  );

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
    // Explicit foreground view — the honest "was I watching?" instrument
    // behind the unattended-trust acceptance proxy.
    reportRunView(sessionId);
    return () => selectSession(null);
  }, [selectSession, reportRunView, sessionId]);

  const { summary, resolveAwaitingInput, isResolvingInput } = useSessionSummary(
    {
      sessionId: sessionId ?? "",
      gatewaySessions: sessions,
      events: selectedSessionEvents,
    },
  );

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator color={colors.muted} />
      </Screen>
    );
  }

  if (!authSession) {
    return <Redirect href="/" />;
  }

  if (!sessionId) {
    return <Redirect href={getMobileTasksDashboardHref(selectedWorkspaceId)} />;
  }

  const liveSession = sessions.find(
    (candidate) => candidate.sessionId === sessionId,
  );
  const workItemId = liveSession?.workItemId ?? null;

  return (
    <View className="bg-background flex-1">
      <Stack.Screen options={{ title: summary.title }} />
      <View
        className="flex-row items-center justify-between gap-3 px-4 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View
          className="flex-row rounded-lg p-1"
          style={{ backgroundColor: colors.secondary }}
          accessibilityRole="tablist"
        >
          {VIEWS.map((item) => {
            const isActive = view === item.key;
            return (
              <Pressable
                key={item.key}
                testID={`session-view-${item.key}`}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                  hapticSelection();
                  setView(item.key);
                }}
                className="rounded-md px-4 py-1.5 active:opacity-70"
                style={{
                  backgroundColor: isActive ? colors.primary : "transparent",
                  minHeight: 32,
                  justifyContent: "center",
                }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: isActive ? colors.background : colors.muted }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {view === "summary" ? (
        <SessionSummaryView
          testID="session-summary"
          summary={summary}
          onApprove={(requestId, decision) =>
            approve(sessionId, requestId, decision)
          }
          onResolveAwaitingInput={resolveAwaitingInput}
          isResolvingInput={isResolvingInput}
          onStop={() => stopSession(sessionId)}
          onOpenThread={() => setView("thread")}
          onOpenWorkItem={
            workItemId
              ? () =>
                  router.push(
                    getMobileOutcomeWorkItemHref(
                      workItemId,
                      selectedWorkspaceId,
                    ),
                  )
              : undefined
          }
        />
      ) : (
        <AgentThreadView
          sessionId={sessionId}
          events={selectedSessionEvents}
          onSendInput={sendInput}
          onStopSession={stopSession}
          title={summary.title}
          canStop={summary.isActive}
        />
      )}
    </View>
  );
}
