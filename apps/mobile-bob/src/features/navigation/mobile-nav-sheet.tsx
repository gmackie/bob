import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";

import { colors } from "~/lib/colors";
import { markActiveDestination } from "./mobile-nav";

interface MobileNavSheetProps {
  visible: boolean;
  pathname: string;
  onClose: () => void;
}

/**
 * Phone navigation sheet. Before this, `/chat` was home, its "Back" was a
 * no-op, and no phone screen linked to tasks, planning, PRs, nodes,
 * notifications or settings — those were reachable only via TabletSidebar.
 */
export function MobileNavSheet({
  visible,
  pathname,
  onClose,
}: MobileNavSheetProps) {
  const destinations = markActiveDestination(pathname);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/60"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
        />
        <View
          className="mt-auto rounded-t-3xl px-5 pt-4 pb-10"
          style={{ backgroundColor: colors.card }}
        >
          <View
            className="mx-auto mb-4 h-1 w-10 rounded-full"
            style={{ backgroundColor: colors.border }}
          />
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-foreground text-lg font-semibold">Go to</Text>
            <Pressable onPress={onClose} className="active:opacity-70">
              <Text className="text-accent text-sm font-semibold">Close</Text>
            </Pressable>
          </View>
          <ScrollView className="max-h-96">
            {destinations.map((destination) => (
              <Pressable
                key={destination.href}
                accessibilityRole="button"
                accessibilityLabel={destination.label}
                className="mb-2 rounded-2xl px-4 py-3 active:opacity-70"
                style={{
                  backgroundColor: destination.isActive
                    ? colors.cardElevated
                    : colors.background,
                }}
                onPress={() => {
                  onClose();
                  if (!destination.isActive) {
                    router.push(destination.href);
                  }
                }}
              >
                <Text
                  className={`text-base font-semibold ${
                    destination.isActive ? "text-accent" : "text-foreground"
                  }`}
                >
                  {destination.label}
                </Text>
                <Text className="text-muted text-xs">
                  {destination.description}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
