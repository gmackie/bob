import * as React from "react";
import { Pressable, Text, StyleSheet, type PressableProps, type TextProps, type StyleProp, type ViewStyle, type TextStyle } from "react-native";

export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends PressableProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
}

export interface ButtonTextProps extends TextProps {
  variant?: ButtonVariant;
  style?: StyleProp<TextStyle>;
}

const variantStyles: Record<ButtonVariant, ViewStyle> = {
  default: { backgroundColor: "#2563EB" },
  destructive: { backgroundColor: "#DC2626" },
  outline: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#D1D5DB" },
  secondary: { backgroundColor: "#E5E7EB" },
  ghost: { backgroundColor: "transparent" },
  link: { backgroundColor: "transparent" },
};

const sizeStyles: Record<ButtonSize, ViewStyle> = {
  default: { height: 44, paddingHorizontal: 16, paddingVertical: 8 },
  sm: { height: 36, paddingHorizontal: 12 },
  lg: { height: 48, paddingHorizontal: 32 },
  icon: { height: 44, width: 44 },
};

const textVariantStyles: Record<ButtonVariant, TextStyle> = {
  default: { color: "#FFFFFF" },
  destructive: { color: "#FFFFFF" },
  outline: { color: "#111827" },
  secondary: { color: "#111827" },
  ghost: { color: "#111827" },
  link: { color: "#2563EB", textDecorationLine: "underline" },
};

const Button = React.forwardRef<React.ElementRef<typeof Pressable>, ButtonProps>(
  ({ variant = "default", size = "default", disabled, style, ...props }, ref) => (
    <Pressable
      ref={ref}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variantStyles[variant],
        sizeStyles[size],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    />
  )
);
Button.displayName = "Button";

const ButtonText = React.forwardRef<React.ElementRef<typeof Text>, ButtonTextProps>(
  ({ variant = "default", style, ...props }, ref) => (
    <Text
      ref={ref}
      style={[styles.buttonText, textVariantStyles[variant], style]}
      {...props}
    />
  )
);
ButtonText.displayName = "ButtonText";

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 6,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "500",
  },
});

export { Button, ButtonText };
