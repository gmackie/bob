import { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";


import type { ChatMessage } from "../chat-messages";
import { MessageBubble } from "./message-bubble";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  statusText: string;
  onPromote?: (message: ChatMessage) => void;
}

export function MessageList({
  messages,
  isStreaming,
  statusText,
  onPromote,
}: MessageListProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, isStreaming]);

  if (messages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-base font-semibold text-foreground">
          Agent chat
        </Text>
        <Text className="mt-2 text-center text-sm leading-5 text-muted">
          {statusText}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: 4, paddingVertical: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onPromote={onPromote}
        />
      ))}
      {isStreaming ? (
        <View className="mb-3 items-start">
          <View className="border-border bg-card rounded-2xl border px-4 py-3">
            <Text className="text-xs font-semibold text-muted">
              Listening for agent output...
            </Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
