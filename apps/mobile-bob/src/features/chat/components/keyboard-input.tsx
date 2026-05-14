import { useCallback, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { colors } from "~/lib/colors";

interface KeyboardInputProps {
  onSend: (text: string) => void;
  onClose: () => void;
  disabled?: boolean;
}

export function KeyboardInput({
  onSend,
  onClose,
  disabled = false,
}: KeyboardInputProps) {
  const [value, setValue] = useState("");

  const send = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [disabled, onSend, value]);

  return (
    <View className="border-border bg-card-elevated rounded-2xl border p-3">
      <TextInput
        value={value}
        onChangeText={setValue}
        multiline
        placeholder="Type a message..."
        placeholderTextColor={colors.muted2}
        editable={!disabled}
        className="min-h-16 rounded-xl px-3 py-2 text-base"
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
        }}
      />
      <View className="mt-3 flex-row gap-2">
        <Pressable
          onPress={onClose}
          className="border-border flex-1 rounded-xl border py-3 active:opacity-80"
        >
          <Text className="text-center font-semibold" style={{ color: colors.muted }}>
            Voice
          </Text>
        </Pressable>
        <Pressable
          onPress={send}
          disabled={disabled || !value.trim()}
          className="bg-primary flex-1 rounded-xl py-3 active:opacity-80 disabled:opacity-50"
        >
          <Text
            className="text-center font-semibold"
            style={{ color: colors.primaryForeground }}
          >
            Send
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
