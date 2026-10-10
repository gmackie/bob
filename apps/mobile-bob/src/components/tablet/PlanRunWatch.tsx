import { Pressable, Text, View } from "react-native";
import type { ServerEvent } from "@bob/ws";

import { formatPlanWatchTitle } from "~/features/planning/plan-execution";
import type { PlanRunWatchTarget } from "~/features/planning/plan-execution";
import { derivePendingPermission } from "~/features/runs/pending-permission";
import { colors } from "~/lib/colors";

import { AgentThreadView } from "./AgentThreadView";

export function PlanRunWatch({
  run,
  events,
  onBack,
  onSendInput,
  onStopSession,
  onApprove,
}: {
  run: PlanRunWatchTarget;
  events: ServerEvent[];
  onBack: () => void;
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  onApprove: (requestId: string, decision: "allow" | "deny") => void;
}) {
  const pendingPermission = derivePendingPermission(events);

  return (
    <View className="min-h-0 flex-1" testID="plan-run-watch">
      <View
        className="flex-row items-center justify-between gap-3 px-4 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-xs uppercase tracking-[0.18em] text-muted">
            Running in Bob
          </Text>
          <Text className="mt-0.5 text-sm font-semibold text-foreground" numberOfLines={1}>
            {formatPlanWatchTitle(run)}
          </Text>
        </View>
        <Pressable
          testID="plan-back-to-plan"
          accessibilityRole="button"
          accessibilityLabel="Back to the plan"
          onPress={onBack}
          className="rounded-md px-3 py-2 active:opacity-80"
          style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
        >
          <Text className="text-xs font-semibold text-foreground">Plan</Text>
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
              onPress={() => onApprove(pendingPermission.requestId, "allow")}
              className="flex-1 items-center rounded-md px-3 py-2 active:opacity-70"
              style={{ backgroundColor: colors.primary, minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-sm font-semibold text-background">Approve</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Deny the pending request"
              onPress={() => onApprove(pendingPermission.requestId, "deny")}
              className="flex-1 items-center rounded-md px-3 py-2 active:opacity-70"
              style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
            >
              <Text className="text-sm font-semibold text-foreground">Deny</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <AgentThreadView
        sessionId={run.sessionId}
        events={events}
        onSendInput={onSendInput}
        onStopSession={onStopSession}
      />
    </View>
  );
}
