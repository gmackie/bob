import { Text, View } from "react-native";
import { colors } from "~/lib/colors";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "accent";
  className?: string;
}

const textColors = {
  default: colors.muted,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
  accent: colors.accent,
} as const;

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variantClasses = {
    default: "border-border bg-background",
    success: "border-success/30 bg-success/10",
    warning: "border-warning/30 bg-warning/10",
    error: "border-error/30 bg-error/10",
    accent: "border-accent/30 bg-accent/10",
  };
  return (
    <View className={`rounded-full border px-2.5 py-1 ${variantClasses[variant]} ${className}`}>
      <Text className="text-xs font-medium" style={{ color: textColors[variant] }}>
        {children}
      </Text>
    </View>
  );
}
