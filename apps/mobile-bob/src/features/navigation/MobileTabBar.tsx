import { Pressable, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors } from "~/lib/colors";

import { MOBILE_TABS, resolveTabForPath, type MobileTabKey } from "./mobile-tabs";

/**
 * The phone's tab bar. Reads the tab model, so the layout cannot list a tab the
 * model does not know. "More" does not navigate: it opens the sheet with the
 * remaining destinations, which is how nothing became unreachable when the
 * sheet stopped being the primary navigation.
 */
export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const active = resolveTabForPath(pathname);

  const go = (key: MobileTabKey, href: string) => {
    if (key === "more") {
      onMore();
      return;
    }
    if (active === key) return;
    // A tab is a place, not a step: replace rather than push so Back does not
    // walk through every tab ever tapped.
    router.replace(href as never);
  };

  return (
    <View
      className="flex-row"
      style={{
        backgroundColor: colors.background,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
      accessibilityRole="tablist"
      testID="mobile-tab-bar"
    >
      {MOBILE_TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => go(tab.key, tab.href)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            className="flex-1 items-center py-2 active:opacity-70"
            testID={`mobile-tab-${tab.key}`}
          >
            <View
              className="mb-1 h-1 w-6 rounded-full"
              style={{ backgroundColor: isActive ? colors.accent : "transparent" }}
            />
            <Text
              className="text-xs font-semibold"
              style={{ color: isActive ? colors.accent : colors.muted }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
