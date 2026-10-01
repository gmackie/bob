import { Pressable, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import type {
  SessionKeyMoment,
  SessionSummary,
  SessionSummaryTone,
} from "./session-summary-model";
import { MarkdownViewer } from "~/components/markdown";
import { LiveChecksCard } from "~/features/runs/LiveChecksCard";
import { colors } from "~/lib/colors";
import { hapticMedium } from "~/lib/haptics";

/**
 * The summary of one session, as both form factors show it.
 *
 * On the phone this is the whole screen until a person asks for the thread.
 * On the tablet it is the right-hand column beside the thread. Same component,
 * so a status the phone calls "needs you" cannot read as "running" on the iPad.
 */

const TONE_COLOR: Record<SessionSummaryTone | "neutral", string> = {
  running: colors.accent,
  attention: colors.warning,
  success: colors.success,
  failure: colors.danger,
  idle: colors.muted,
  neutral: colors.muted2,
};

export interface SessionSummaryViewProps {
  summary: SessionSummary;
  onApprove?: (requestId: string, decision: "allow" | "deny") => void;
  onResolveAwaitingInput?: (value: string) => void;
  isResolvingInput?: boolean;
  onStop?: () => void;
  onOpenWorkItem?: () => void;
  /** Phone only: switch to the full event stream. */
  onOpenThread?: () => void;
  /** When embedded beside the thread the view scrolls inside its column. */
  embedded?: boolean;
  testID?: string;
}

function openUrl(url: string) {
  WebBrowser.openBrowserAsync(url).catch(() => {
    // A browser that refuses to open is not something the summary can fix.
  });
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-muted text-xs font-semibold tracking-[0.16em] uppercase">
      {children}
    </Text>
  );
}

function Panel({
  children,
  tone,
  testID,
}: {
  children: React.ReactNode;
  tone?: SessionSummaryTone;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      className="mb-3 rounded-lg border p-4"
      style={{
        borderColor: tone ? TONE_COLOR[tone] + "66" : colors.border,
        backgroundColor: colors.card,
      }}
    >
      {children}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  emphasis = "secondary",
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  emphasis?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const background =
    emphasis === "primary"
      ? colors.primary
      : emphasis === "danger"
        ? colors.danger + "22"
        : colors.secondary;
  const foreground =
    emphasis === "primary"
      ? colors.background
      : emphasis === "danger"
        ? colors.danger
        : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={() => {
        hapticMedium();
        onPress();
      }}
      className="items-center justify-center rounded-md px-4 active:opacity-70"
      style={{
        backgroundColor: background,
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text className="text-sm font-semibold" style={{ color: foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MomentRow({
  moment,
  isLast,
}: {
  moment: SessionKeyMoment;
  isLast: boolean;
}) {
  return (
    <View
      className="flex-row gap-3 py-2.5"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        className="mt-1.5 h-2 w-2 rounded-full"
        style={{ backgroundColor: TONE_COLOR[moment.tone] }}
      />
      <View className="min-w-0 flex-1">
        <Text
          className="text-xs font-semibold"
          style={{ color: TONE_COLOR[moment.tone] }}
        >
          {moment.label}
        </Text>
        <Text className="text-foreground mt-0.5 text-sm" numberOfLines={4}>
          {moment.text}
        </Text>
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[72px]">
      <Text className="text-foreground text-base font-semibold">{value}</Text>
      <Text className="text-muted text-xs">{label}</Text>
    </View>
  );
}

export function SessionSummaryView({
  summary,
  onApprove,
  onResolveAwaitingInput,
  isResolvingInput = false,
  onStop,
  onOpenWorkItem,
  onOpenThread,
  embedded = false,
  testID,
}: SessionSummaryViewProps) {
  const toneColor = TONE_COLOR[summary.tone];
  const permission = summary.pendingPermission;
  const question = summary.awaitingInput;

  return (
    <ScrollView
      testID={testID}
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: embedded ? 12 : 16,
        paddingTop: 12,
        paddingBottom: 32,
      }}
    >
      {/* Status: the answer to "how is it going?" before anything else. */}
      <Panel tone={summary.tone} testID="session-summary-status">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: toneColor }}
          />
          <Text
            className="text-xs font-semibold tracking-[0.16em] uppercase"
            style={{ color: toneColor }}
          >
            {summary.statusLabel}
          </Text>
          <Text className="text-muted text-xs">· {summary.agentLabel}</Text>
          {summary.elapsedLabel ? (
            <Text className="text-muted text-xs">· {summary.elapsedLabel}</Text>
          ) : null}
        </View>
        <Text className="text-foreground mt-2 text-base leading-6 font-semibold">
          {summary.headline}
        </Text>
        {summary.lastActivityLabel ? (
          <Text className="text-muted mt-1 text-xs">
            Last activity {summary.lastActivityLabel}
          </Text>
        ) : null}
      </Panel>

      {permission && onApprove ? (
        <Panel tone="attention" testID="session-summary-approval">
          <SectionLabel>Approval needed</SectionLabel>
          <Text className="text-foreground mt-1 text-sm">
            {permission.toolName
              ? `The agent wants to use ${permission.toolName}.`
              : "The agent is waiting for your approval."}
          </Text>
          <View className="mt-3 flex-row gap-3">
            <View className="flex-1">
              <ActionButton
                label="Approve"
                emphasis="primary"
                accessibilityLabel="Approve the pending request"
                onPress={() => onApprove(permission.requestId, "allow")}
              />
            </View>
            <View className="flex-1">
              <ActionButton
                label="Deny"
                accessibilityLabel="Deny the pending request"
                onPress={() => onApprove(permission.requestId, "deny")}
              />
            </View>
          </View>
        </Panel>
      ) : null}

      {question ? (
        <Panel tone="attention" testID="session-summary-question">
          <SectionLabel>The agent is asking</SectionLabel>
          <Text className="text-foreground mt-1 text-sm leading-5">
            {question.question}
          </Text>
          {onResolveAwaitingInput ? (
            <View className="mt-3 gap-2">
              {(question.options ?? []).map((option) => (
                <ActionButton
                  key={option}
                  label={option}
                  emphasis={
                    option === question.defaultAction ? "primary" : "secondary"
                  }
                  accessibilityLabel={`Answer ${option}`}
                  disabled={isResolvingInput}
                  onPress={() => onResolveAwaitingInput(option)}
                />
              ))}
              {!question.options?.includes(question.defaultAction) ? (
                <ActionButton
                  label={`Use default: ${question.defaultAction}`}
                  emphasis="primary"
                  disabled={isResolvingInput}
                  onPress={() => onResolveAwaitingInput(question.defaultAction)}
                />
              ) : null}
            </View>
          ) : null}
        </Panel>
      ) : null}

      {summary.error && summary.tone === "failure" ? (
        <Panel tone="failure">
          <SectionLabel>Error</SectionLabel>
          <Text className="text-foreground mt-1 text-sm leading-5">
            {summary.error}
          </Text>
        </Panel>
      ) : null}

      {summary.checks.length > 0 ? (
        <View className="mb-3">
          <SectionLabel>Checks</SectionLabel>
          <LiveChecksCard rows={summary.checks} />
        </View>
      ) : null}

      {summary.latestMessage ? (
        <Panel testID="session-summary-message">
          <SectionLabel>Latest from the agent</SectionLabel>
          <View className="mt-2">
            <MarkdownViewer source={summary.latestMessage} compact />
          </View>
        </Panel>
      ) : null}

      <Panel>
        <View className="flex-row flex-wrap gap-x-6 gap-y-3">
          <Stat label="tool calls" value={String(summary.counts.toolCalls)} />
          <Stat label="messages" value={String(summary.counts.messages)} />
          <Stat
            label="files edited"
            value={String(summary.counts.filesEdited)}
          />
          <Stat label="errors" value={String(summary.counts.errors)} />
        </View>
        {summary.pullRequestUrl || summary.branch ? (
          <View className="mt-3 gap-2">
            {summary.pullRequestUrl ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open pull request"
                onPress={() => openUrl(summary.pullRequestUrl ?? "")}
                className="active:opacity-70"
              >
                <Text
                  className="text-primary text-sm font-semibold"
                  numberOfLines={1}
                >
                  Pull request ↗
                </Text>
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {summary.pullRequestUrl}
                </Text>
              </Pressable>
            ) : null}
            {summary.branch ? (
              <Text className="text-muted text-xs" numberOfLines={1}>
                Branch {summary.branch}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Panel>

      {summary.keyMoments.length > 0 ? (
        <Panel testID="session-summary-moments">
          <SectionLabel>Key moments</SectionLabel>
          <View className="mt-1">
            {summary.keyMoments.map((moment, index) => (
              <MomentRow
                key={moment.id}
                moment={moment}
                isLast={index === summary.keyMoments.length - 1}
              />
            ))}
          </View>
        </Panel>
      ) : null}

      {onOpenThread || onOpenWorkItem || (onStop && summary.isActive) ? (
        <View className="mt-1 gap-2">
          {onOpenThread ? (
            <ActionButton label="Read the full thread" onPress={onOpenThread} />
          ) : null}
          {onOpenWorkItem ? (
            <ActionButton
              label={
                summary.identifier
                  ? `Open ${summary.identifier}`
                  : "Open work item"
              }
              onPress={onOpenWorkItem}
            />
          ) : null}
          {onStop && summary.isActive ? (
            <ActionButton
              label="Stop session"
              emphasis="danger"
              accessibilityLabel="Stop this session"
              onPress={onStop}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
