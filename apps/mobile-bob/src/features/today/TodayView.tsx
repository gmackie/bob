import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import type { TodayItemRow, TodayView as TodayViewModel } from "./today-model";
import type { SessionSummaryTone } from "~/features/sessions/session-summary-model";
import { MarkdownViewer } from "~/components/markdown";
import { EmptyState } from "~/components/ui";
import { colors } from "~/lib/colors";
import { hapticMedium } from "~/lib/haptics";

/**
 * The day, on both form factors: what was planned, how it is going, and the
 * review once it is over. The phone shows this as a screen; the tablet shows
 * it as the main pane.
 */

const TONE_COLOR: Record<SessionSummaryTone, string> = {
  running: colors.accent,
  attention: colors.warning,
  success: colors.success,
  failure: colors.danger,
  idle: colors.muted,
};

export interface TodayViewProps {
  view: TodayViewModel | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  onRefresh: () => void;
  onGenerate: () => void;
  onApprove: () => void;
  onClose: () => void;
  onOpenWorkItem: (href: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSessions?: () => void;
  embedded?: boolean;
  testID?: string;
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

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-muted text-xs font-semibold tracking-[0.16em] uppercase">
      {children}
    </Text>
  );
}

function ActionButton({
  label,
  onPress,
  emphasis = "secondary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  emphasis?: "primary" | "secondary";
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        hapticMedium();
        onPress();
      }}
      className="items-center justify-center rounded-md px-4 active:opacity-70"
      style={{
        backgroundColor:
          emphasis === "primary" ? colors.primary : colors.secondary,
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{
          color: emphasis === "primary" ? colors.background : colors.foreground,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ItemRow({
  item,
  isLast,
  onPress,
}: {
  item: TodayItemRow;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.identifier ?? item.title}`}
      onPress={onPress}
      className="flex-row items-start gap-3 py-3 active:opacity-70"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        className="mt-1.5 h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: TONE_COLOR[item.tone] }}
      />
      <View className="min-w-0 flex-1">
        <Text
          className="text-foreground text-sm font-semibold"
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text className="text-muted mt-0.5 text-xs" numberOfLines={1}>
          {[item.identifier, item.projectName, item.sourceLabel]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text className="text-muted2 mt-1 text-xs" numberOfLines={2}>
          {item.objective}
        </Text>
      </View>
      <Text
        className="text-xs font-semibold"
        style={{ color: TONE_COLOR[item.tone] }}
      >
        {item.statusLabel}
      </Text>
    </Pressable>
  );
}

export function TodayView({
  view,
  isLoading,
  isMutating,
  error,
  onRefresh,
  onGenerate,
  onApprove,
  onClose,
  onOpenWorkItem,
  onOpenSession,
  onOpenSessions,
  embedded = false,
  testID,
}: TodayViewProps) {
  const padding = embedded ? 16 : 16;

  if (isLoading && !view) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  if (!view) {
    return (
      <ScrollView
        testID={testID}
        className="flex-1"
        contentContainerStyle={{ padding, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={onRefresh} />
        }
      >
        <EmptyState
          icon="☼"
          title="No plan for today yet"
          hint={
            error
              ? `Could not load the plan: ${error}`
              : "Bob builds one each morning from the queue and the BizPulse briefing. You can build it now."
          }
          action={
            <ActionButton
              label={isMutating ? "Planning…" : "Plan today now"}
              emphasis="primary"
              disabled={isMutating}
              onPress={onGenerate}
            />
          }
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      testID={testID}
      className="flex-1"
      contentContainerStyle={{ padding, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={onRefresh} />
      }
    >
      <Panel tone={view.tone} testID="today-status">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: TONE_COLOR[view.tone] }}
          />
          <Text
            className="text-xs font-semibold tracking-[0.16em] uppercase"
            style={{ color: TONE_COLOR[view.tone] }}
          >
            {view.statusLabel}
          </Text>
          <Text className="text-muted text-xs">· {view.dateLabel}</Text>
        </View>
        <Text className="text-foreground mt-2 text-base leading-6 font-semibold">
          {view.headline}
        </Text>
        {view.progress.total > 0 ? (
          <View
            className="mt-3 h-1.5 overflow-hidden rounded-full"
            style={{ backgroundColor: colors.secondary }}
          >
            <View
              className="h-full rounded-full"
              style={{
                width: `${Math.round(view.progress.fraction * 100)}%`,
                backgroundColor: TONE_COLOR[view.tone],
              }}
            />
          </View>
        ) : null}
        {view.intakeLabel ? (
          <Text className="text-muted mt-2 text-xs">{view.intakeLabel}</Text>
        ) : null}
        {view.intakeError ? (
          <Text className="mt-2 text-xs" style={{ color: colors.danger }}>
            Intake failed: {view.intakeError}
          </Text>
        ) : null}
        {error ? (
          <Text className="mt-2 text-xs" style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
      </Panel>

      {view.canApprove || view.canRegenerate || view.canClose ? (
        <View className="mb-3 flex-row gap-3">
          {view.canApprove ? (
            <View className="flex-1">
              <ActionButton
                label={isMutating ? "Working…" : "Approve plan"}
                emphasis="primary"
                disabled={isMutating}
                onPress={onApprove}
              />
            </View>
          ) : null}
          {view.canRegenerate ? (
            <View className="flex-1">
              <ActionButton
                label="Rebuild"
                disabled={isMutating}
                onPress={onGenerate}
              />
            </View>
          ) : null}
          {view.canClose ? (
            <View className="flex-1">
              <ActionButton
                label={isMutating ? "Working…" : "Close & review"}
                disabled={isMutating}
                onPress={onClose}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {view.review ? (
        <Panel testID="today-review">
          <SectionLabel>Review</SectionLabel>
          <View className="mt-2">
            <MarkdownViewer source={view.review.summary} compact />
          </View>
          <Text className="text-muted mt-2 text-xs">
            Sessions: {view.review.sessionsLabel}
          </Text>
          {view.review.sections.map((section) => (
            <View key={section.outcome} className="mt-3">
              <Text className="text-foreground text-xs font-semibold">
                {section.title}
              </Text>
              {section.rows.map((row) => (
                <View
                  key={row.workItemId}
                  className="mt-1 flex-row flex-wrap items-center gap-2"
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onOpenWorkItem(row.href)}
                    className="active:opacity-70"
                  >
                    <Text className="text-foreground text-sm">
                      {[row.identifier, row.title].filter(Boolean).join(" ")}
                    </Text>
                  </Pressable>
                  {row.sessionIds.map((sessionId, index) => (
                    <Pressable
                      key={sessionId}
                      accessibilityRole="button"
                      accessibilityLabel={`Open session ${index + 1} for ${row.identifier ?? row.title}`}
                      onPress={() => onOpenSession(sessionId)}
                      className="rounded-md px-2 py-0.5 active:opacity-70"
                      style={{ backgroundColor: colors.secondary }}
                    >
                      <Text className="text-primary text-xs font-semibold">
                        session {index + 1}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          ))}
          {view.review.unplannedSessionIds.length > 0 && onOpenSessions ? (
            <Pressable
              accessibilityRole="button"
              onPress={onOpenSessions}
              className="mt-3 active:opacity-70"
            >
              <Text className="text-primary text-sm font-semibold">
                {view.review.unplannedSessionIds.length} session
                {view.review.unplannedSessionIds.length === 1 ? "" : "s"} ran
                outside the plan ›
              </Text>
            </Pressable>
          ) : null}
        </Panel>
      ) : null}

      {view.items.length > 0 ? (
        <Panel testID="today-items">
          <SectionLabel>
            {view.status === "closed" ? "What was planned" : "The plan"}
          </SectionLabel>
          <View className="mt-1">
            {view.items.map((item, index) => (
              <ItemRow
                key={item.workItemId}
                item={item}
                isLast={index === view.items.length - 1}
                onPress={() => onOpenWorkItem(item.href)}
              />
            ))}
          </View>
        </Panel>
      ) : null}

      {view.summary ? (
        <Panel testID="today-summary">
          <SectionLabel>Why this plan</SectionLabel>
          <View className="mt-2">
            <MarkdownViewer source={view.summary} compact />
          </View>
        </Panel>
      ) : null}
    </ScrollView>
  );
}
