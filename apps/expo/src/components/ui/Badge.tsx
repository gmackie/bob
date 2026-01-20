import { Text, View } from "react-native";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "accent";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  className = "",
}: BadgeProps) {
  const variantClasses = {
    default: "border-border bg-background",
    success: "border-success/30 bg-success/10",
    warning: "border-warning/30 bg-warning/10",
    danger: "border-danger/30 bg-danger/10",
    accent: "border-accent/30 bg-accent/10",
  };

  const textClasses = {
    default: "text-muted",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    accent: "text-accent",
  };

  return (
    <View
      className={`rounded-full border px-2.5 py-1 ${variantClasses[variant]} ${className}`}
    >
      <Text className={`text-xs font-medium ${textClasses[variant]}`}>
        {children}
      </Text>
    </View>
  );
}
