import { useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { trpc } from "../lib/trpc";
import { tw, colors } from "../lib/styles";

interface CommentComposerProps {
  issueId: string;
  onCommentAdded?: () => void;
}

export function CommentComposer({ issueId, onCommentAdded }: CommentComposerProps) {
  const [text, setText] = useState("");
  const utils = trpc.useUtils();

  const createMutation = trpc.comment.create.useMutation({
    onSuccess: () => {
      setText("");
      utils.comment.list.invalidate({ issueId });
      utils.issue.get.invalidate({ id: issueId });
      onCommentAdded?.();
    },
  });

  const handleSubmit = () => {
    if (!text.trim()) return;

    createMutation.mutate({
      issueId,
      body: text.trim(),
    });
  };

  const isDisabled = !text.trim() || createMutation.isPending;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={tw("flex-row items-end bg-white border-t border-gray-200 px-4 py-3 gap-3")}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Write a comment..."
          placeholderTextColor="#9ca3af"
          multiline
          maxLength={10000}
          style={[tw("flex-1 bg-gray-100 rounded-2xl px-4 text-gray-900"), { paddingVertical: 10, minHeight: 40, maxHeight: 128 }]}
        />
        <Pressable
          onPress={handleSubmit}
          disabled={isDisabled}
          style={[
            tw("h-10 w-10 rounded-full items-center justify-center"),
            { backgroundColor: isDisabled ? colors["gray-200"] : colors["indigo-600"] }
          ]}
        >
          {createMutation.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <SendIcon color={isDisabled ? "#9ca3af" : "#fff"} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function SendIcon({ color }: { color: string }) {
  return (
    <View style={{ transform: [{ rotate: "-45deg" }] }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 8,
          borderRightWidth: 8,
          borderBottomWidth: 14,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: color,
        }}
      />
    </View>
  );
}
