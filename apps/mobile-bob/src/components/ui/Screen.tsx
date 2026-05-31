import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ScreenProps {
  children: React.ReactNode;
  className?: string;
}

export function Screen({ children, className = "" }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className={`bg-background flex-1`}
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className={`flex-1 px-5 ${className}`}>{children}</View>
    </View>
  );
}
