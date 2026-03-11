import * as React from "react";
import { View, Text, StyleSheet, type ViewProps, type TextProps, type StyleProp, type ViewStyle, type TextStyle } from "react-native";

export interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export interface CardTextProps extends TextProps {
  style?: StyleProp<TextStyle>;
}

const Card = React.forwardRef<React.ElementRef<typeof View>, CardProps>(
  ({ style, ...props }, ref) => (
    <View ref={ref} style={[styles.card, style]} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<React.ElementRef<typeof View>, CardProps>(
  ({ style, ...props }, ref) => (
    <View ref={ref} style={[styles.cardHeader, style]} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<React.ElementRef<typeof Text>, CardTextProps>(
  ({ style, ...props }, ref) => (
    <Text ref={ref} style={[styles.cardTitle, style]} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<React.ElementRef<typeof Text>, CardTextProps>(
  ({ style, ...props }, ref) => (
    <Text ref={ref} style={[styles.cardDescription, style]} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<React.ElementRef<typeof View>, CardProps>(
  ({ style, ...props }, ref) => (
    <View ref={ref} style={[styles.cardContent, style]} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<React.ElementRef<typeof View>, CardProps>(
  ({ style, ...props }, ref) => (
    <View ref={ref} style={[styles.cardFooter, style]} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    gap: 6,
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
  },
  cardDescription: {
    fontSize: 14,
    color: "#6B7280",
  },
  cardContent: {
    padding: 16,
    paddingTop: 0,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    paddingTop: 0,
  },
});

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
