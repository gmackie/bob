import * as React from "react";
import { View, Text, StyleSheet, type ViewProps, type TextProps, type StyleProp, type ViewStyle, type TextStyle } from "react-native";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface BadgeProps extends ViewProps {
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
}

export interface BadgeTextProps extends TextProps {
  variant?: BadgeVariant;
  style?: StyleProp<TextStyle>;
}

const variantStyles: Record<BadgeVariant, ViewStyle> = {
  default: { backgroundColor: "#2563EB" },
  secondary: { backgroundColor: "#E5E7EB" },
  destructive: { backgroundColor: "#DC2626" },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#D1D5DB" },
};

const textVariantStyles: Record<BadgeVariant, TextStyle> = {
  default: { color: "#FFFFFF" },
  secondary: { color: "#111827" },
  destructive: { color: "#FFFFFF" },
  outline: { color: "#111827" },
};

const Badge = React.forwardRef<React.ElementRef<typeof View>, BadgeProps>(
  ({ variant = "default", style, ...props }, ref) => (
    <View
      ref={ref}
      style={[styles.badge, variantStyles[variant], style]}
      {...props}
    />
  )
);
Badge.displayName = "Badge";

const BadgeText = React.forwardRef<React.ElementRef<typeof Text>, BadgeTextProps>(
  ({ variant = "default", style, ...props }, ref) => (
    <Text
      ref={ref}
      style={[styles.badgeText, textVariantStyles[variant], style]}
      {...props}
    />
  )
);
BadgeText.displayName = "BadgeText";

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
});

export { Badge, BadgeText };
