import { Pressable, Text, View } from "react-native";
import { colors } from "~/lib/colors";

interface ButtonProps {
  children: React.ReactNode;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm";
  icon?: React.ReactNode;
  accessibilityLabel?: string;
  disabled?: boolean;
  className?: string;
}

const textColors = {
  primary: colors.primaryForeground,
  secondary: colors.foreground,
  ghost: colors.muted,
} as const;

export function Button({
  children,
  onPress,
  variant = "primary",
  size = "default",
  icon,
  disabled = false,
  className = "",
  accessibilityLabel,
}: ButtonProps) {
  const baseClasses = "flex-row items-center justify-center rounded-xl";
  const sizeClasses =
    size === "sm" ? "min-h-11 px-3 py-2" : "min-h-12 px-4 py-2";
  const variantClasses = {
    primary: "bg-primary",
    secondary: "bg-card-elevated border border-border",
    ghost: "bg-transparent",
  };
  const textWeights = {
    primary: "font-semibold",
    secondary: "font-semibold",
    ghost: "font-medium",
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (typeof children === "string" ? children : undefined)
      }
      accessibilityState={{ disabled }}
      disabled={disabled}
      className={`${baseClasses} ${sizeClasses} ${variantClasses[variant]} ${className} ${disabled ? "opacity-50" : "active:opacity-90"}`}
    >
      {icon && <View className="mr-2">{icon}</View>}
      <Text
        className={textWeights[variant]}
        style={{ color: textColors[variant] }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
