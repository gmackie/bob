import { View } from "react-native";

interface CardProps {
  children: React.ReactNode;
  variant?: "default" | "elevated";
  className?: string;
}

export function Card({
  children,
  variant = "default",
  className = "",
}: CardProps) {
  const baseClasses = "rounded-2xl border border-border p-4";
  const variantClasses =
    variant === "elevated" ? "bg-card-elevated" : "bg-card";

  return (
    <View className={`${baseClasses} ${variantClasses} ${className}`}>
      {children}
    </View>
  );
}
