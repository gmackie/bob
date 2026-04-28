/**
 * Design tokens as plain values for React Native inline styles.
 *
 * NativeWind v5 preview + react-native-css 3.0.1 cannot resolve
 * Tailwind v4 CSS variables (`var(--color-*)`) for the `color`
 * property on Text. Background/spacing/layout utilities work fine.
 *
 * These constants mirror the @theme block in styles.css and are the
 * source of truth for text color until NativeWind v5 stable ships.
 *
 * TODO: Remove when NativeWind v5 stable resolves CSS variable colors.
 */
export const colors = {
  foreground: "#e6edf3",
  muted: "#8b949e",
  muted2: "#667085",
  primary: "#7c3aed",
  primaryForeground: "#ffffff",
  secondaryForeground: "#e6edf3",
  cardForeground: "#e6edf3",
  accent: "#22d3ee",
  accentForeground: "#0b0f14",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  white: "#ffffff",
  background: "#0b0f14",
  card: "#111827",
  cardElevated: "#162033",
  secondary: "#162033",
  border: "#233047",
} as const;
