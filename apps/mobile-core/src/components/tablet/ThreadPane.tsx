import { useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message, Thread } from "@gmacko/core/contracts";
import { rpc } from "~/utils/api";
import { Button } from "../ui/Button";
import { colors } from "~/lib/colors";

export function ThreadPane({ thread }: { thread: Thread }) {
  const [draft, setDraft] = useState("");
  const list = useRef<FlatList<Message>>(null);
  const qc = useQueryClient();
  const branchId = thread.activeBranchId;
  const messages = useQuery({
    queryKey: ["messages", thread.id, branchId],
    queryFn: () => rpc.messages.listByBranch(thread.id, branchId!),
    enabled: !!branchId,
  });
  const chat = useMutation({
    mutationFn: rpc.agent.chat,
    onSuccess: async (_, sent) => {
      setDraft((current) => (current.trim() === sent.content ? "" : current));
      await qc.invalidateQueries({
        queryKey: ["messages", sent.threadId, sent.branchId],
      });
      list.current?.scrollToEnd({ animated: true });
    },
  });
  const send = () => {
    if (branchId && draft.trim() && !chat.isPending)
      chat.mutate({ threadId: thread.id, branchId, content: draft.trim() });
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        ref={list}
        data={messages.data ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        renderItem={({ item }) => (
          <View
            className={`rounded-xl px-3 py-2 ${item.role === "user" ? "self-end bg-card-elevated" : "self-start bg-card"}`}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: colors.accent }}
            >
              {item.role}
            </Text>
            <Text style={{ color: colors.foreground }}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ color: colors.muted }}>
            {!branchId
              ? "This thread has no active branch."
              : messages.isPending
                ? "Loading messages…"
                : messages.isError
                  ? "Could not load messages."
                  : "Start a conversation."}
          </Text>
        }
      />
      <View className="px-4 py-2 border-t border-border">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          accessibilityLabel="Thread message"
          multiline
          placeholder="Type a message…"
          placeholderTextColor={colors.muted}
          className="bg-card rounded-xl px-3 py-2 mb-2"
          style={{ color: colors.foreground, minHeight: 44, maxHeight: 120 }}
        />
        {chat.isError && (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            Message could not be sent. Try again.
          </Text>
        )}
        <Button
          onPress={send}
          disabled={!branchId || !draft.trim() || chat.isPending}
        >
          {chat.isPending ? "Sending…" : "Send"}
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
