import { Platform, StyleSheet } from "react-native";

import { colors } from "~/lib/colors";

const HEADING_FONT = Platform.select({ ios: "Avenir Next", default: "System" });
const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

interface ThemeOptions {
  compact?: boolean;
}

/**
 * Styles for react-native-markdown-display, keyed by its rule names.
 * Dark warm-gray surfaces, amber links, readable body type.
 */
export function createMarkdownTheme({ compact = false }: ThemeOptions = {}) {
  const bodySize = compact ? 14 : 16;
  const bodyLineHeight = compact ? 21 : 24;
  const scale = compact ? 0.875 : 1;

  return StyleSheet.create({
    body: {
      color: colors.foreground,
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: compact ? 8 : 12,
      flexWrap: "wrap",
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "flex-start",
    },
    text: {
      color: colors.foreground,
    },
    heading1: {
      color: colors.foreground,
      fontFamily: HEADING_FONT,
      fontWeight: "700",
      fontSize: Math.round(26 * scale),
      lineHeight: Math.round(32 * scale),
      marginTop: compact ? 12 : 16,
      marginBottom: compact ? 6 : 8,
    },
    heading2: {
      color: colors.foreground,
      fontFamily: HEADING_FONT,
      fontWeight: "700",
      fontSize: Math.round(22 * scale),
      lineHeight: Math.round(28 * scale),
      marginTop: compact ? 10 : 14,
      marginBottom: compact ? 4 : 6,
    },
    heading3: {
      color: colors.foreground,
      fontFamily: HEADING_FONT,
      fontWeight: "600",
      fontSize: Math.round(18 * scale),
      lineHeight: Math.round(24 * scale),
      marginTop: compact ? 8 : 12,
      marginBottom: 4,
    },
    heading4: {
      color: colors.foreground,
      fontFamily: HEADING_FONT,
      fontWeight: "600",
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
      marginTop: 8,
      marginBottom: 4,
    },
    heading5: {
      color: colors.secondaryForeground,
      fontFamily: HEADING_FONT,
      fontWeight: "600",
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
      marginTop: 8,
      marginBottom: 2,
    },
    heading6: {
      color: colors.muted,
      fontFamily: HEADING_FONT,
      fontWeight: "600",
      fontSize: bodySize - 2,
      lineHeight: bodyLineHeight - 2,
      marginTop: 8,
      marginBottom: 2,
    },
    strong: {
      fontWeight: "700",
      color: colors.foreground,
    },
    em: {
      fontStyle: "italic",
    },
    s: {
      textDecorationLine: "line-through",
      color: colors.muted,
    },
    bullet_list: {
      marginBottom: compact ? 8 : 12,
    },
    ordered_list: {
      marginBottom: compact ? 8 : 12,
    },
    list_item: {
      flexDirection: "row",
      justifyContent: "flex-start",
      marginBottom: 4,
    },
    bullet_list_icon: {
      color: colors.muted,
      marginLeft: 4,
      marginRight: 10,
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
    },
    ordered_list_icon: {
      color: colors.muted,
      marginLeft: 4,
      marginRight: 10,
      fontSize: bodySize,
      lineHeight: bodyLineHeight,
      fontVariant: ["tabular-nums"],
    },
    bullet_list_content: {
      flex: 1,
    },
    ordered_list_content: {
      flex: 1,
    },
    blockquote: {
      backgroundColor: "transparent",
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
      paddingLeft: 12,
      paddingVertical: 2,
      marginLeft: 0,
      marginBottom: compact ? 8 : 12,
    },
    code_inline: {
      fontFamily: MONO_FONT,
      fontSize: bodySize - 2,
      backgroundColor: colors.secondary,
      color: colors.foreground,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    code_block: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
      color: colors.foreground,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      padding: 10,
      marginBottom: compact ? 8 : 12,
    },
    fence: {
      fontFamily: MONO_FONT,
      fontSize: 12,
      lineHeight: 18,
      color: colors.foreground,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      padding: 10,
      marginBottom: compact ? 8 : 12,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      marginBottom: compact ? 8 : 12,
      overflow: "hidden",
    },
    thead: {
      backgroundColor: colors.cardElevated,
    },
    tbody: {},
    th: {
      flex: 1,
      minWidth: 96,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    tr: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    td: {
      flex: 1,
      minWidth: 96,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    link: {
      color: colors.accent,
      textDecorationLine: "underline",
      textDecorationColor: colors.accent,
    },
    blocklink: {
      flex: 1,
      borderColor: colors.border,
      borderBottomWidth: 1,
    },
    image: {
      flex: 1,
      borderRadius: 6,
      overflow: "hidden",
      marginBottom: compact ? 8 : 12,
    },
    hr: {
      backgroundColor: colors.border,
      height: 1,
      marginVertical: compact ? 12 : 16,
    },
    textgroup: {},
    hardbreak: {
      width: "100%",
      height: 1,
    },
    softbreak: {},
    inline: {},
    span: {},
  });
}

export type MarkdownTheme = ReturnType<typeof createMarkdownTheme>;
