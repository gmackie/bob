import { Pressable, Text, View } from "react-native";

import { colors } from "~/lib/colors";

import type { ChatMessage } from "../chat-messages";
import { isPromotableMessage } from "../chat-messages";

interface MessageBubbleProps {
  message: ChatMessage;
  onPromote?: (message: ChatMessage) => void;
}

function labelFor(message: ChatMessage): string {
  if (message.role === "user") return "You";
  if (message.mode === "ooda") return "OODA";
  return "Bob";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageBubble({ message, onPromote }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const canPromote = onPromote && isPromotableMessage(message);

  return (
    <View className={`mb-3 ${isUser ? "items-end" : "items-start"}`}>
      <View
        className={`max-w-[88%] rounded-2xl border px-4 py-3 ${
          isUser
            ? "bg-primary border-primary"
            : "bg-card-elevated border-border"
        }`}
      >
        <View className="mb-1 flex-row items-center gap-2">
          <Text
            className="text-xs font-semibold"
            style={{
              color: isUser ? colors.primaryForeground : colors.foreground,
            }}
          >
            {labelFor(message)}
          </Text>
          <Text
            className="text-[10px]"
            style={{ color: isUser ? colors.primaryForeground : colors.muted2 }}
          >
            {formatTime(message.timestamp)}
          </Text>
        </View>
        <Text
          className="text-sm leading-6"
          style={{
            color: isUser ? colors.primaryForeground : colors.secondaryForeground,
          }}
        >
          {message.content}
        </Text>
        {canPromote ? (
          <Pressable
            onPress={() => onPromote(message)}
            className="border-border bg-background mt-3 self-start rounded-lg border px-3 py-1.5 active:opacity-80"
          >
            <Text className="text-xs font-semibold" style={{ color: colors.accent }}>
              Promote
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
