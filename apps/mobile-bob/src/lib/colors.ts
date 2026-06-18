/**
 * Design tokens as plain values for React Native inline styles.
 *
 * Derived from Bob's dark theme in tooling/bob-tailwind/theme.css (oklch values
 * converted to hex). NativeWind v5 preview cannot resolve CSS variables for
 * the `color` property on Text, so these are used as fallbacks.
 *
 * TODO: Remove when NativeWind v5 stable resolves CSS variable colors.
 */
export const colors = {
  foreground: "#eeedea",
  muted: "#6e6b63",
  muted2: "#565349",
  primary: "#e7a505",
  primaryForeground: "#141310",
  secondaryForeground: "#a8a59d",
  cardForeground: "#eeedea",
  accent: "#e7a505",
  accentForeground: "#141310",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef5350",
  white: "#ffffff",
  background: "#141310",
  card: "#1c1b18",
  cardElevated: "#232220",
  secondary: "#232220",
  border: "#2e2d2a",
} as const;
