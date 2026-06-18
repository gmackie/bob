import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface ScreenProps {
  children: React.ReactNode;
  className?: string;
}

export function Screen({ children, className = "" }: ScreenProps) {
  return (
    <SafeAreaView className="bg-background flex-1">
      <View className={`flex-1 px-5 ${className}`}>{children}</View>
    </SafeAreaView>
  );
}
