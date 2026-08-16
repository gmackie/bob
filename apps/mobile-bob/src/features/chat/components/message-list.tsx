import { memo, useCallback } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { LegendList } from "@legendapp/list";

import type {
  OodaMessageTimelineItem,
  OodaTimelineItem,
} from "../ooda-timeline";
import { colors } from "~/lib/colors";
import { canResearchConversationItem } from "../conversation-research-model";

interface MessageListProps {
  items: OodaTimelineItem[];
  statusText: string;
  onRetry?: (outboxId: string) => void;
  onSpeak?: (item: OodaMessageTimelineItem) => void;
  canCorrect?: boolean;
  onCorrect?: (item: OodaMessageTimelineItem) => void;
  canResearch?: boolean;
  researchingItemId?: string | null;
  onResearch?: (item: OodaMessageTimelineItem) => void;
  onOpenProposal?: (proposalId: string) => void;
  onOpenJob?: (jobId: string) => void;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const MessageRow = memo(function MessageRow({
  item,
  onRetry,
  onSpeak,
  canCorrect,
  onCorrect,
  canResearch,
  researchingItemId,
  onResearch,
}: {
  item: OodaMessageTimelineItem;
  onRetry?: (outboxId: string) => void;
  onSpeak?: (item: OodaMessageTimelineItem) => void;
  canCorrect?: boolean;
  onCorrect?: (item: OodaMessageTimelineItem) => void;
  canResearch?: boolean;
  researchingItemId?: string | null;
  onResearch?: (item: OodaMessageTimelineItem) => void;
}) {
  const isUser = item.role === "user";
  const status =
    item.deliveryState === "synced" || item.deliveryState === "streaming"
      ? undefined
      : item.deliveryState;
  const retryId = item.outboxId;
  const showListen = !isUser && Boolean(item.speakable && onSpeak);
  const showCorrection = Boolean(
    isUser &&
      item.deliveryState === "synced" &&
      item.event?.type === "user_turn" &&
      canCorrect &&
      onCorrect,
  );
  const showResearch = Boolean(
    canResearch && onResearch && canResearchConversationItem(item),
  );
  const isResearching = researchingItemId === item.id;
  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[90%] rounded-2xl border px-4 py-3 ${
          isUser
            ? "border-primary bg-primary"
            : "border-border bg-card-elevated"
        }`}
      >
        <View className="mb-1 flex-row items-center gap-2">
          <Text
            className="text-xs font-semibold"
            style={{
              color: isUser ? colors.primaryForeground : colors.foreground,
            }}
          >
            {isUser ? "You" : "OODA"}
          </Text>
          <Text
            className="text-[10px]"
            style={{ color: isUser ? colors.primaryForeground : colors.muted2 }}
          >
            {formatTime(item.timestamp)}
            {item.corrected ? " · edited" : ""}
          </Text>
        </View>
        <Text
          className="text-sm leading-6"
          style={{
            color: isUser
              ? colors.primaryForeground
              : colors.secondaryForeground,
          }}
        >
          {item.display}
        </Text>
        {status ? (
          <View className="mt-2 flex-row items-center justify-end gap-2">
            <Text
              className="text-[11px] font-semibold"
              style={{
                color: isUser ? colors.primaryForeground : colors.muted,
              }}
            >
              {status === "queued"
                ? "Queued"
                : status === "syncing"
                  ? "Syncing…"
                  : "Sync failed"}
            </Text>
            {status === "failed" && retryId && onRetry ? (
              <Pressable
                onPress={() => onRetry(retryId)}
                className="bg-background/20 rounded-md px-2 py-1 active:opacity-70"
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{
                    color: isUser ? colors.primaryForeground : colors.accent,
                  }}
                >
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {showListen || showCorrection || showResearch ? (
          <View
            className={`mt-3 flex-row items-center gap-4 ${isUser ? "self-end" : "self-start"}`}
          >
            {showListen ? (
              <Pressable
                onPress={() => onSpeak?.(item)}
                className="active:opacity-70"
              >
                <Text className="text-accent text-xs font-semibold">
                  Listen
                </Text>
              </Pressable>
            ) : null}
            {showCorrection ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Correct saved turn"
                onPress={() => onCorrect?.(item)}
                className="active:opacity-70"
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: colors.primaryForeground }}
                >
                  Edit
                </Text>
              </Pressable>
            ) : null}
            {showResearch ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Research this message"
                disabled={isResearching}
                onPress={() => onResearch?.(item)}
                className="active:opacity-70 disabled:opacity-50"
              >
                <Text
                  className="text-xs font-semibold"
                  style={{
                    color: isUser ? colors.primaryForeground : colors.accent,
                  }}
                >
                  {isResearching ? "Researching…" : "Research"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
});

const ActivityRow = memo(function ActivityRow({
  item,
  onOpenProposal,
  onOpenJob,
}: {
  item: Exclude<OodaTimelineItem, OodaMessageTimelineItem>;
  onOpenProposal?: (proposalId: string) => void;
  onOpenJob?: (jobId: string) => void;
}) {
  const label =
    item.kind === "tool"
      ? "Tool"
      : item.kind === "citation"
        ? "Source"
        : item.kind === "proposal"
          ? "Proposal"
          : item.kind === "job"
            ? "Agent job"
            : item.kind === "evidence"
              ? "Evidence"
              : item.tone === "error"
                ? "Problem"
                : "OODA";
  const link = "url" in item ? item.url : undefined;
  const status = "status" in item ? item.status : undefined;
  const proposalId = item.kind === "proposal" ? item.proposalId : undefined;
  const jobId = item.kind === "job" ? item.jobId : undefined;
  return (
    <View className="mb-3 items-start">
      <View
        className={`w-full rounded-xl border px-4 py-3 ${
          item.kind === "system" && item.tone === "error"
            ? "border-danger/40 bg-danger/10"
            : "border-border bg-card"
        }`}
      >
        <View className="mb-1 flex-row items-center justify-between gap-3">
          <Text className="text-muted text-xs font-semibold tracking-wide uppercase">
            {label}
          </Text>
          {status ? (
            <Text className="text-accent text-xs font-semibold">
              {status.replaceAll("_", " ")}
            </Text>
          ) : null}
        </View>
        <Text className="text-foreground text-sm leading-5">
          {item.display}
        </Text>
        {item.kind === "proposal" && item.rationale ? (
          <Text className="text-muted mt-2 text-xs leading-5">
            {item.rationale}
          </Text>
        ) : null}
        {proposalId && onOpenProposal ? (
          <Pressable
            onPress={() => onOpenProposal(proposalId)}
            className="mt-3 self-start active:opacity-70"
          >
            <Text className="text-accent text-xs font-semibold">Review</Text>
          </Pressable>
        ) : null}
        {jobId && onOpenJob ? (
          <Pressable
            onPress={() => onOpenJob(jobId)}
            className="mt-3 self-start active:opacity-70"
          >
            <Text className="text-accent text-xs font-semibold">Inspect</Text>
          </Pressable>
        ) : null}
        {link ? (
          <Pressable
            onPress={() => void Linking.openURL(link)}
            className="mt-2 self-start active:opacity-70"
          >
            <Text className="text-accent text-xs font-semibold">Open</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

export function MessageList({
  items,
  statusText,
  onRetry,
  onSpeak,
  canCorrect,
  onCorrect,
  canResearch,
  researchingItemId,
  onResearch,
  onOpenProposal,
  onOpenJob,
}: MessageListProps) {
  const renderItem = useCallback(
    ({ item }: { item: OodaTimelineItem }) =>
      item.kind === "message" ? (
        <MessageRow
          item={item}
          onRetry={onRetry}
          onSpeak={onSpeak}
          canCorrect={canCorrect}
          onCorrect={onCorrect}
          canResearch={canResearch}
          researchingItemId={researchingItemId}
          onResearch={onResearch}
        />
      ) : (
        <ActivityRow
          item={item}
          onOpenProposal={onOpenProposal}
          onOpenJob={onOpenJob}
        />
      ),
    [
      canCorrect,
      canResearch,
      onCorrect,
      onOpenJob,
      onOpenProposal,
      onResearch,
      onRetry,
      onSpeak,
      researchingItemId,
    ],
  );

  if (!items.length) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-foreground text-center text-base font-semibold">
          New thought
        </Text>
        <Text className="text-muted mt-2 text-center text-sm leading-5">
          {statusText}
        </Text>
      </View>
    );
  }

  return (
    <LegendList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemType={(item) => item.kind}
      estimatedItemSize={112}
      maintainScrollAtEnd={{ onDataChange: true, onItemLayout: true }}
      maintainScrollAtEndThreshold={0.2}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: 4, paddingVertical: 16 }}
      showsVerticalScrollIndicator={false}
    />
  );
}
