import { Pressable, Text, View } from "react-native";


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
        {/* Generated work items carry a whole paragraph as their title — the
            research backlog averages 236 characters. Unclamped, one row filled
            the screen and the list stopped being a list. Two lines is enough to
            identify a row; the detail screen has the rest. */}
        <Text
          className="text-base font-semibold text-foreground"
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {title}
        </Text>
        {subtitle && (
          <Text className="text-sm text-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
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
