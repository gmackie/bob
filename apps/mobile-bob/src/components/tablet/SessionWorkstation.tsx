import { useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import type { ServerEvent } from "@bob/ws";

import type { GatewaySession } from "~/hooks/use-gateway";
import { SessionSummaryView } from "~/features/sessions/SessionSummaryView";
import { useSessionSummary } from "~/features/sessions/use-session-summary";
import { colors } from "~/lib/colors";
import { hapticSelection } from "~/lib/haptics";
import { AgentThreadView } from "./AgentThreadView";

/**
 * A session on the tablet: the thread and its summary side by side.
 *
 * The iPad is for reading and steering, so it gets both at once: the full
 * event stream in the main column and, beside it, the same summary the phone
 * shows — status, approvals, the agent's question, checks, key moments. The
 * tablet pane used to be the bare thread with no approval controls at all;
 * a blocked run could only be approved from a phone.
 *
 * Below the split threshold (iPad portrait, Split View) the two stack behind
 * a segmented control, the same way the phone does it.
 */

export const SESSION_WORKSTATION_SPLIT_MIN_WIDTH = 1000;
const SUMMARY_COLUMN_WIDTH = 380;

export function shouldSplitSessionWorkstation(width: number): boolean {
  return width >= SESSION_WORKSTATION_SPLIT_MIN_WIDTH;
}

type Pane = "thread" | "summary";

export interface SessionWorkstationProps {
  sessionId: string;
  sessions: readonly GatewaySession[];
  events: ServerEvent[];
  onSendInput: (sessionId: string, data: string) => void;
  onStopSession: (sessionId: string) => void;
  onApprove: (
    sessionId: string,
    requestId: string,
    decision: "allow" | "deny",
  ) => void;
  onReportRunView: (sessionId: string) => void;
  onOpenWorkItem?: (workItemId: string) => void;
  onOpenInspector?: () => void;
}

export function SessionWorkstation({
  sessionId,
  sessions,
  events,
  onSendInput,
  onStopSession,
  onApprove,
  onReportRunView,
  onOpenWorkItem,
  onOpenInspector,
}: SessionWorkstationProps) {
  const { width } = useWindowDimensions();
  const split = shouldSplitSessionWorkstation(width);
  const [pane, setPane] = useState<Pane>("summary");

  useEffect(() => {
    onReportRunView(sessionId);
  }, [onReportRunView, sessionId]);

  const { summary, resolveAwaitingInput, isResolvingInput } = useSessionSummary(
    {
      sessionId,
      gatewaySessions: sessions,
      events,
    },
  );
  const live = sessions.find((candidate) => candidate.sessionId === sessionId);
  const workItemId = live?.workItemId ?? null;

  const summaryView = (
    <SessionSummaryView
      testID="tablet-session-summary"
      summary={summary}
      embedded
      onApprove={(requestId, decision) =>
        onApprove(sessionId, requestId, decision)
      }
      onResolveAwaitingInput={resolveAwaitingInput}
      isResolvingInput={isResolvingInput}
      onStop={() => onStopSession(sessionId)}
      onOpenWorkItem={
        workItemId && onOpenWorkItem
          ? () => onOpenWorkItem(workItemId)
          : undefined
      }
    />
  );

  const thread = (
    <AgentThreadView
      sessionId={sessionId}
      events={events}
      onSendInput={onSendInput}
      onStopSession={onStopSession}
      title={summary.title}
      showHeader={false}
      canStop={summary.isActive}
    />
  );

  const header = (
    <View
      className="flex-row items-center justify-between gap-3 px-4 py-2"
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-foreground text-sm font-semibold"
          numberOfLines={1}
        >
          {summary.title}
        </Text>
        <Text className="text-muted text-xs" numberOfLines={1}>
          {[summary.identifier, summary.agentLabel, summary.statusLabel]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      {!split ? (
        <View
          className="flex-row rounded-lg p-1"
          style={{ backgroundColor: colors.secondary }}
          accessibilityRole="tablist"
        >
          {(
            [
              { key: "summary", label: "Summary" },
              { key: "thread", label: "Thread" },
            ] as const
          ).map((item) => {
            const isActive = pane === item.key;
            return (
              <Pressable
                key={item.key}
                testID={`tablet-session-pane-${item.key}`}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                  hapticSelection();
                  setPane(item.key);
                }}
                className="rounded-md px-3 py-1.5 active:opacity-70"
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
      ) : null}
      {onOpenInspector ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open inspector"
          onPress={onOpenInspector}
          className="rounded-md px-3 py-1.5 active:opacity-70"
          style={{
            backgroundColor: colors.secondary,
            minHeight: 32,
            justifyContent: "center",
          }}
        >
          <Text className="text-foreground text-xs font-semibold">Files</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!split) {
    return (
      <View className="flex-1" testID="tablet-session-workstation">
        {header}
        {pane === "summary" ? summaryView : thread}
      </View>
    );
  }

  return (
    <View className="flex-1" testID="tablet-session-workstation">
      {header}
      <View className="flex-1 flex-row">
        <View className="flex-1" style={{ minWidth: 0 }}>
          {thread}
        </View>
        <View
          testID="tablet-session-summary-column"
          style={{
            width: SUMMARY_COLUMN_WIDTH,
            borderLeftWidth: 1,
            borderLeftColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          {summaryView}
        </View>
      </View>
    </View>
  );
}
