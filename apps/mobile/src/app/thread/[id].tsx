import { useState, useRef } from "react";
import { Text, FlatList, TextInput, View, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { Message } from "@gmacko/models";
import { Screen } from "~/components/ui/Screen";
import { Button } from "~/components/ui/Button";
import { Badge } from "~/components/ui/Badge";
import { colors } from "~/lib/colors";

export default function ThreadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    const msg: Message = {
      id: crypto.randomUUID(),
      threadId: id!,
      branchId: "main",
      parentId: messages.at(-1)?.id ?? null,
      role: "user",
      content: input.trim(),
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View className="flex-1">
        {/* Header */}
        <View className="px-5 py-3 border-b border-border flex-row items-center">
          <Text className="text-lg font-semibold flex-1" style={{ color: colors.foreground }}>
            Thread
          </Text>
          <Badge variant="accent">main</Badge>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <View
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                item.role === "user"
                  ? "self-end bg-primary"
                  : "self-start bg-card-elevated"
              }`}
            >
              <Text
                className="text-sm"
                style={{
                  color: item.role === "user" ? colors.primaryForeground : colors.foreground,
                }}
              >
                {item.content}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-base mb-2" style={{ color: colors.muted }}>
                Start a conversation
              </Text>
              <Text className="text-sm" style={{ color: colors.muted2 }}>
                Ask a question or share an idea to begin exploring
              </Text>
            </View>
          }
        />

        {/* Composer */}
        <View className="px-4 py-3 border-t border-border flex-row items-end gap-2">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor={colors.muted}
            multiline
            className="flex-1 bg-card rounded-xl px-4 py-3 text-sm border border-border"
            style={{ color: colors.foreground, maxHeight: 120 }}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Button
            onPress={handleSend}
            size="sm"
            disabled={!input.trim()}
          >
            Send
          </Button>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
