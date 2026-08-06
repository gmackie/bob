import { LegendList } from "@legendapp/list";
import { memo, useCallback } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { colors } from "~/lib/colors";

import type {
  OodaMessageTimelineItem,
  OodaTimelineItem,
} from "../ooda-timeline";

interface MessageListProps {
  items: OodaTimelineItem[];
  statusText: string;
  onRetry?: (outboxId: string) => void;
  onSpeak?: (item: OodaMessageTimelineItem) => void;
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
}: {
  item: OodaMessageTimelineItem;
  onRetry?: (outboxId: string) => void;
  onSpeak?: (item: OodaMessageTimelineItem) => void;
}) {
  const isUser = item.role === "user";
  const status = item.deliveryState === "synced" || item.deliveryState === "streaming"
    ? undefined
    : item.deliveryState;
  const retryId = item.outboxId;
  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      <View className={`max-w-[90%] rounded-2xl border px-4 py-3 ${
        isUser ? "border-primary bg-primary" : "border-border bg-card-elevated"
      }`}>
        <View className="mb-1 flex-row items-center gap-2">
          <Text
            className="text-xs font-semibold"
            style={{ color: isUser ? colors.primaryForeground : colors.foreground }}
          >
            {isUser ? "You" : "OODA"}
          </Text>
          <Text
            className="text-[10px]"
            style={{ color: isUser ? colors.primaryForeground : colors.muted2 }}
          >
            {formatTime(item.timestamp)}{item.corrected ? " · edited" : ""}
          </Text>
        </View>
        <Text
          className="text-sm leading-6"
          style={{ color: isUser ? colors.primaryForeground : colors.secondaryForeground }}
        >
          {item.display}
        </Text>
        {status ? (
          <View className="mt-2 flex-row items-center justify-end gap-2">
            <Text
              className="text-[11px] font-semibold"
              style={{ color: isUser ? colors.primaryForeground : colors.muted }}
            >
              {status === "queued" ? "Queued" : status === "syncing" ? "Syncing…" : "Sync failed"}
            </Text>
            {status === "failed" && retryId && onRetry ? (
              <Pressable
                onPress={() => onRetry(retryId)}
                className="rounded-md bg-background/20 px-2 py-1 active:opacity-70"
              >
                <Text
                  className="text-[11px] font-semibold"
                  style={{ color: isUser ? colors.primaryForeground : colors.accent }}
                >
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {!isUser && item.speakable && onSpeak ? (
          <Pressable onPress={() => onSpeak(item)} className="mt-3 self-start active:opacity-70">
            <Text className="text-xs font-semibold text-accent">Listen</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const ActivityRow = memo(function ActivityRow({ item }: { item: Exclude<OodaTimelineItem, OodaMessageTimelineItem> }) {
  const label = item.kind === "tool"
    ? "Tool"
    : item.kind === "citation"
      ? "Source"
      : item.kind === "proposal"
        ? "Proposal"
        : item.kind === "job"
          ? "Agent job"
          : item.kind === "evidence"
            ? "Evidence"
            : item.tone === "error" ? "Problem" : "OODA";
  const link = "url" in item ? item.url : undefined;
  const status = "status" in item ? item.status : undefined;
  return (
    <View className="mb-3 items-start">
      <View className={`w-full rounded-xl border px-4 py-3 ${
        item.kind === "system" && item.tone === "error"
          ? "border-danger/40 bg-danger/10"
          : "border-border bg-card"
      }`}>
        <View className="mb-1 flex-row items-center justify-between gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</Text>
          {status ? <Text className="text-xs font-semibold text-accent">{status.replaceAll("_", " ")}</Text> : null}
        </View>
        <Text className="text-sm leading-5 text-foreground">{item.display}</Text>
        {item.kind === "proposal" && item.rationale ? (
          <Text className="mt-2 text-xs leading-5 text-muted">{item.rationale}</Text>
        ) : null}
        {link ? (
          <Pressable onPress={() => void Linking.openURL(link)} className="mt-2 self-start active:opacity-70">
            <Text className="text-xs font-semibold text-accent">Open</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

export function MessageList({ items, statusText, onRetry, onSpeak }: MessageListProps) {
  const renderItem = useCallback(({ item }: { item: OodaTimelineItem }) =>
    item.kind === "message" ? (
      <MessageRow item={item} onRetry={onRetry} onSpeak={onSpeak} />
    ) : (
      <ActivityRow item={item} />
    ), [onRetry, onSpeak]);

  if (!items.length) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-base font-semibold text-foreground">New thought</Text>
        <Text className="mt-2 text-center text-sm leading-5 text-muted">{statusText}</Text>
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
