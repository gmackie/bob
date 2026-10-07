import { Text, View } from "react-native";

import { Button, Screen } from "~/components/ui";

export function SessionRecoveryScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen className="items-center justify-center">
      <View className="items-center gap-4 px-6">
        <Text className="text-foreground text-2xl font-semibold">
          Reconnecting to Bob
        </Text>
        <Text className="text-muted text-center">
          Bob could not check your session. We will try again when the
          connection returns.
        </Text>
        <Button onPress={onRetry} variant="secondary">
          Try again
        </Button>
      </View>
    </Screen>
  );
}
