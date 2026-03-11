import * as React from "react";
import { View, StyleSheet, type ViewProps, type StyleProp, type ViewStyle } from "react-native";

export interface SeparatorProps extends ViewProps {
  orientation?: "horizontal" | "vertical";
  style?: StyleProp<ViewStyle>;
}

const Separator = React.forwardRef<React.ElementRef<typeof View>, SeparatorProps>(
  ({ orientation = "horizontal", style, ...props }, ref) => (
    <View
      ref={ref}
      style={[
        styles.separator,
        orientation === "horizontal" ? styles.horizontal : styles.vertical,
        style,
      ]}
      {...props}
    />
  )
);
Separator.displayName = "Separator";

const styles = StyleSheet.create({
  separator: {
    backgroundColor: "#E5E7EB",
  },
  horizontal: {
    height: 1,
    width: "100%",
  },
  vertical: {
    width: 1,
    height: "100%",
  },
});

export { Separator };
