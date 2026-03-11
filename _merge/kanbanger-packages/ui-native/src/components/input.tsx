import * as React from "react";
import { TextInput, StyleSheet, type TextInputProps, type StyleProp, type TextStyle } from "react-native";

export interface InputProps extends TextInputProps {
  style?: StyleProp<TextStyle>;
}

const Input = React.forwardRef<React.ElementRef<typeof TextInput>, InputProps>(
  ({ editable = true, style, ...props }, ref) => (
    <TextInput
      ref={ref}
      editable={editable}
      placeholderTextColor="#9CA3AF"
      style={[styles.input, !editable && styles.disabled, style]}
      {...props}
    />
  )
);
Input.displayName = "Input";

const styles = StyleSheet.create({
  input: {
    height: 44,
    width: "100%",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    fontSize: 16,
    color: "#111827",
  },
  disabled: {
    opacity: 0.5,
  },
});

export { Input };
