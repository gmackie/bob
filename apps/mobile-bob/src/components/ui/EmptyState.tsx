import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { colors } from "~/lib/colors";

interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Optional glyph/emoji shown above the title. */
  icon?: string;
  /** Optional action rendered under the hint (e.g. a Button). */
  action?: ReactNode;
  /** "card" draws the bordered container; "plain" is for use inside an existing card/list. */
  variant?: "card" | "plain";
  testID?: string;
}

/**
 * Shared empty state so every dashboard, rail, and list speaks the same
 * language: quiet title, one-line hint, optional next step. Keeps the
 * industrial/utilitarian tone — no illustrations, no exclamation marks.
 */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  variant = "card",
  testID,
}: EmptyStateProps) {
  return (
    <View
      testID={testID}
      className={variant === "card" ? "items-center rounded-lg border" : "items-center"}
      style={[
        { paddingHorizontal: 20, paddingVertical: variant === "card" ? 28 : 24 },
        variant === "card"
          ? { borderColor: colors.border, backgroundColor: colors.card }
          : null,
      ]}
    >
      {icon ? (
        <Text className="mb-2 text-xl" style={{ color: colors.muted2 }}>
          {icon}
        </Text>
      ) : null}
      <Text className="text-center text-sm font-semibold" style={{ color: colors.secondaryForeground }}>
        {title}
      </Text>
      {hint ? (
        <Text className="mt-1 text-center text-xs leading-5" style={{ color: colors.muted }}>
          {hint}
        </Text>
      ) : null}
      {action ? <View className="mt-4">{action}</View> : null}
    </View>
  );
}
