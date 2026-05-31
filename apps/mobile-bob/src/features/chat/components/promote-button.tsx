import { Pressable, Text } from "react-native";

import { colors } from "~/lib/colors";

interface PromoteButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export function PromoteButton({ onPress, disabled = false }: PromoteButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="border-border bg-background rounded-lg border px-3 py-1.5 active:opacity-80 disabled:opacity-50"
    >
      <Text className="text-xs font-semibold text-accent">
        Promote
      </Text>
    </Pressable>
  );
}
