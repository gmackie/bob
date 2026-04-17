import { View, Text, FlatList, TextInput, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import type { Message } from "@gmacko/models";

export default function ThreadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        threadId: id!,
        branchId: "main",
        parentId: prev.at(-1)?.id ?? null,
        role: "user",
        content: input.trim(),
        createdAt: new Date(),
      },
    ]);
    setInput("");
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        style={styles.list}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message..."
          placeholderTextColor="#6b6863"
          onSubmitEditing={handleSend}
        />
        <Pressable
          onPress={handleSend}
          style={[styles.sendButton, !input.trim() && styles.sendDisabled]}
          disabled={!input.trim()}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1, padding: 16 },
  bubble: { maxWidth: "80%", borderRadius: 12, padding: 12, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#d4a04a" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#222228" },
  messageText: { color: "#e8e4df", fontSize: 14 },
  composer: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#2a2a2f",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#1a1a1f",
    borderRadius: 8,
    padding: 10,
    color: "#e8e4df",
    borderWidth: 1,
    borderColor: "#2a2a2f",
  },
  sendButton: { backgroundColor: "#d4a04a", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: "#111113", fontWeight: "600" },
});
