import { Pressable, Text, View } from "react-native";

import { colors } from "~/lib/colors";

interface ListRowProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  showDivider?: boolean;
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  showDivider = true,
}: ListRowProps) {
  const content = (
    <View
      className={`flex-row items-center justify-between py-3 ${showDivider ? "border-border/60 border-b" : ""}`}
    >
      <View className="flex-1 space-y-0.5">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        {subtitle && <Text className="text-sm text-muted">{subtitle}</Text>}
      </View>
      {right && <View className="ml-3">{right}</View>}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-80">
        {content}
      </Pressable>
    );
  }

  return content;
}
