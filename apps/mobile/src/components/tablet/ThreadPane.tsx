import { useState, useRef } from "react";
import {
  FlatList,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import type { Message } from "@gmacko/models";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { colors } from "~/lib/colors";

interface ThreadPaneProps {
  threadTitle: string;
  branchName: string;
  messages: Message[];
  onSend: (content: string) => void;
  onSynthesize?: () => void;
  isLoading?: boolean;
}

export function ThreadPane({
  threadTitle,
  branchName,
  messages,
  onSend,
  onSynthesize,
  isLoading,
}: ThreadPaneProps) {
  const [input, setInput] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View className="px-4 py-3 border-b border-border flex-row items-center">
        <View className="flex-1">
          <Text
            className="text-lg font-semibold"
            style={{ color: colors.foreground }}
            numberOfLines={1}
          >
            {threadTitle}
          </Text>
          <Badge variant="accent" className="self-start mt-1">
            {branchName}
          </Badge>
        </View>
        {onSynthesize && (
          <Button onPress={onSynthesize} variant="secondary" size="sm">
            Write up
          </Button>
        )}
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
                color:
                  item.role === "user"
                    ? colors.primaryForeground
                    : colors.foreground,
              }}
            >
              {item.content}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center py-20">
            <Text style={{ color: colors.muted }}>Start exploring</Text>
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
          disabled={!input.trim() || isLoading}
        >
          Send
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
