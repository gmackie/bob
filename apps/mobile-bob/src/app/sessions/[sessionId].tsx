import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ServerEvent } from "@bob/ws";

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

/**
 * A run is awaiting approval when a permission_request event has no matching
 * permission_resolved. The latest unresolved request drives the banner;
 * approving/denying resolves it via the gateway → daemon → CLI.
 *
 * Pure and module-scoped: the React Compiler (experiments.reactCompiler, see
 * app.config.js) memoizes the call site for us, so a manual useMemo here is
 * redundant — and unpreservable, which is what tripped
 * react-hooks/preserve-manual-memoization ("memoized in source but not in
 * compilation output").
 */
export function derivePendingPermission(
  events: ServerEvent[],
): { requestId: string; toolName?: string } | null {
  const resolved = new Set<string>();
  let latestRunStatus: string | undefined;
  for (const event of events) {
    if (event.eventType === ("permission_resolved" as never)) {
      const requestId = (event.payload as { requestId?: string }).requestId;
      if (requestId) resolved.add(requestId);
    } else if (event.eventType === ("status_change" as never)) {
      const status = (event.payload as { status?: string }).status;
      if (status) latestRunStatus = status;
    }
  }
  // Once the run leaves "blocked" (resumed or ended), any lingering request is
  // stale — clear the banner. status_change events are always replayed even
  // when chatty output is truncated, so this stays correct.
  if (latestRunStatus !== undefined && latestRunStatus !== "blocked") {
    return null;
  }
  // The newest UNRESOLVED request drives the banner. Keep scanning past a
  // resolved newest request to surface an older still-pending one (the adapter
  // supports concurrent pending prompts) instead of stopping early.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (event.eventType === ("permission_request" as never)) {
      const payload = event.payload as { requestId?: string; toolName?: string };
      if (payload.requestId && !resolved.has(payload.requestId)) {
        return { requestId: payload.requestId, toolName: payload.toolName };
      }
    }
  }
  return null;
}

export default function ExecutionSessionScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ sessionId: string }>();
  const rawSessionIdParam: unknown = params.sessionId;
  const sessionId = Array.isArray(rawSessionIdParam)
    ? (rawSessionIdParam[0] as string | undefined)
    : (rawSessionIdParam as string | undefined);
  const gateway = useGateway();
  const { selectedWorkspaceId } = useSelectedWorkspace();
  const {
    selectSession,
    selectedSessionEvents,
    sendInput,
    stopSession,
    approve,
    reportRunView,
  } = gateway;

  useEffect(() => {
    if (!sessionId) return;
    selectSession(sessionId);
    // Explicit foreground view — the honest "was I watching?" instrument
    // behind the unattended-trust acceptance proxy.
    reportRunView(sessionId);
    return () => selectSession(null);
  }, [selectSession, reportRunView, sessionId]);

  const pendingPermission = derivePendingPermission(selectedSessionEvents);

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
      {pendingPermission ? (
        <View
          className="px-4 py-3"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
          accessibilityRole="alert"
        >
          <Text className="text-xs uppercase tracking-[0.18em] text-muted">
            Approval needed
          </Text>
          <Text className="mt-1 text-sm text-foreground">
            {pendingPermission.toolName
              ? `The agent wants to use ${pendingPermission.toolName}.`
              : "The agent is waiting for your approval."}
          </Text>
          <View className="mt-3 flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve the pending request"
              onPress={() => approve(sessionId, pendingPermission.requestId, "allow")}
              className="flex-1 items-center rounded-md px-3 py-2 active:opacity-70"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-sm font-semibold text-background">Approve</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny the pending request"
              onPress={() => approve(sessionId, pendingPermission.requestId, "deny")}
              className="flex-1 items-center rounded-md px-3 py-2 active:opacity-70"
              style={{ backgroundColor: colors.secondary }}
            >
              <Text className="text-sm font-semibold text-foreground">Deny</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <AgentThreadView
        sessionId={sessionId}
        events={selectedSessionEvents}
        onSendInput={sendInput}
        onStopSession={stopSession}
      />
    </View>
  );
}
