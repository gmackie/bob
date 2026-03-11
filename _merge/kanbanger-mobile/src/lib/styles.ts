import { StyleSheet, type ViewStyle, type TextStyle, type ImageStyle } from "react-native";

type Style = ViewStyle & TextStyle & ImageStyle;

export const palette = {
  "gray-50": "#F9FAFB",
  "gray-100": "#F3F4F6",
  "gray-200": "#E5E7EB",
  "gray-300": "#D1D5DB",
  "gray-400": "#9CA3AF",
  "gray-500": "#6B7280",
  "gray-600": "#4B5563",
  "gray-700": "#374151",
  "gray-800": "#1F2937",
  "gray-900": "#111827",
  "indigo-100": "#E0E7FF",
  "indigo-300": "#A5B4FC",
  "indigo-500": "#6366F1",
  "indigo-600": "#4F46E5",
  "indigo-700": "#4338CA",
  "indigo-900": "#312E81",
  "blue-100": "#DBEAFE",
  "blue-300": "#93C5FD",
  "blue-500": "#3B82F6",
  "blue-600": "#2563EB",
  "blue-700": "#1D4ED8",
  "blue-900": "#1E3A8A",
  "red-50": "#FEF2F2",
  "red-100": "#FEE2E2",
  "red-300": "#FCA5A5",
  "red-500": "#EF4444",
  "red-600": "#DC2626",
  "red-900": "#7F1D1D",
  "green-100": "#DCFCE7",
  "green-300": "#86EFAC",
  "green-500": "#22C55E",
  "green-600": "#16A34A",
  "green-900": "#14532D",
  "orange-100": "#FFEDD5",
  "orange-500": "#F97316",
  "orange-600": "#EA580C",
  "orange-900": "#7C2D12",
  "yellow-300": "#FDE047",
  "yellow-500": "#EAB308",
  "yellow-600": "#CA8A04",
  "yellow-900": "#713F12",
  "purple-300": "#D8B4FE",
  "purple-500": "#A855F7",
  "purple-600": "#9333EA",
  "purple-900": "#581C87",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

// Backwards compatibility
export const colors = palette;

type ColorKey = keyof typeof palette;

const colorMap: Record<string, string> = palette;

const spacingMap: Record<string, number> = {
  "0": 0,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
  "10": 40,
  "12": 48,
  "16": 64,
};

const fontSizeMap: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
};

export function tw(...classNames: (string | undefined | null | false)[]): Style {
  const result: Style = {};
  
  for (const className of classNames) {
    if (!className) continue;
    
    const classes = className.split(/\s+/);
    for (const cls of classes) {
      Object.assign(result, parseClass(cls));
    }
  }
  
  return result;
}

function parseClass(cls: string): Style {
  if (cls === "flex-1") return { flex: 1 };
  if (cls === "flex-row") return { flexDirection: "row" };
  if (cls === "flex-col") return { flexDirection: "column" };
  if (cls === "flex-wrap") return { flexWrap: "wrap" };
  
  if (cls === "items-center") return { alignItems: "center" };
  if (cls === "items-start") return { alignItems: "flex-start" };
  if (cls === "items-end") return { alignItems: "flex-end" };
  if (cls === "justify-center") return { justifyContent: "center" };
  if (cls === "justify-between") return { justifyContent: "space-between" };
  if (cls === "justify-start") return { justifyContent: "flex-start" };
  if (cls === "justify-end") return { justifyContent: "flex-end" };
  if (cls === "self-center") return { alignSelf: "center" };
  
  if (cls === "text-center") return { textAlign: "center" };
  if (cls === "text-left") return { textAlign: "left" };
  if (cls === "text-right") return { textAlign: "right" };
  
  if (cls === "font-normal") return { fontWeight: "400" };
  if (cls === "font-medium") return { fontWeight: "500" };
  if (cls === "font-semibold") return { fontWeight: "600" };
  if (cls === "font-bold") return { fontWeight: "700" };
  if (cls === "font-light") return { fontWeight: "300" };
  if (cls === "font-mono") return { fontFamily: "monospace" };
  
  if (cls === "underline") return { textDecorationLine: "underline" };
  if (cls === "line-through") return { textDecorationLine: "line-through" };
  if (cls === "capitalize") return { textTransform: "capitalize" };
  if (cls === "uppercase") return { textTransform: "uppercase" };
  
  if (cls === "overflow-hidden") return { overflow: "hidden" };
  
  if (cls === "relative") return { position: "relative" };
  if (cls === "absolute") return { position: "absolute" };
  
  if (cls === "rounded") return { borderRadius: 4 };
  if (cls === "rounded-sm") return { borderRadius: 2 };
  if (cls === "rounded-md") return { borderRadius: 6 };
  if (cls === "rounded-lg") return { borderRadius: 8 };
  if (cls === "rounded-xl") return { borderRadius: 12 };
  if (cls === "rounded-2xl") return { borderRadius: 16 };
  if (cls === "rounded-full") return { borderRadius: 9999 };
  
  if (cls === "border") return { borderWidth: 1 };
  if (cls === "border-t") return { borderTopWidth: 1 };
  if (cls === "border-b") return { borderBottomWidth: 1 };
  if (cls === "border-l") return { borderLeftWidth: 1 };
  if (cls === "border-r") return { borderRightWidth: 1 };
  if (cls === "border-2") return { borderWidth: 2 };
  
  if (cls === "shadow-sm") return { 
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  };
  if (cls === "shadow") return { 
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  };
  if (cls === "shadow-lg") return { 
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  };
  
  if (cls === "opacity-50") return { opacity: 0.5 };
  if (cls === "opacity-70") return { opacity: 0.7 };
  
  const spacingMatch = cls.match(/^(m|p|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|gap)-(\d+\.?\d*)$/);
  if (spacingMatch) {
    const prop = spacingMatch[1];
    const size = spacingMatch[2];
    if (prop && size) {
      const value = spacingMap[size] ?? parseInt(size, 10) * 4;
      
      switch (prop) {
        case "m": return { margin: value };
        case "mt": return { marginTop: value };
        case "mb": return { marginBottom: value };
        case "ml": return { marginLeft: value };
        case "mr": return { marginRight: value };
        case "mx": return { marginHorizontal: value };
        case "my": return { marginVertical: value };
        case "p": return { padding: value };
        case "pt": return { paddingTop: value };
        case "pb": return { paddingBottom: value };
        case "pl": return { paddingLeft: value };
        case "pr": return { paddingRight: value };
        case "px": return { paddingHorizontal: value };
        case "py": return { paddingVertical: value };
        case "gap": return { gap: value };
      }
    }
  }
  
  const sizeMatch = cls.match(/^(w|h|min-h)-(\d+\.?\d*|full)$/);
  if (sizeMatch) {
    const prop = sizeMatch[1];
    const size = sizeMatch[2];
    if (prop && size) {
      const value = size === "full" ? "100%" : (spacingMap[size] ?? parseInt(size, 10) * 4);
      
      if (prop === "w") return { width: value };
      if (prop === "h") return { height: value };
      if (prop === "min-h") return { minHeight: value };
    }
  }
  
  const textMatch = cls.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)$/);
  if (textMatch) {
    const size = textMatch[1];
    if (size && fontSizeMap[size]) {
      return { fontSize: fontSizeMap[size] };
    }
  }
  
  const textColorMatch = cls.match(/^text-(.+)$/);
  if (textColorMatch) {
    const colorKey = textColorMatch[1];
    if (colorKey && colorMap[colorKey]) {
      return { color: colorMap[colorKey] };
    }
  }
  
  const bgMatch = cls.match(/^bg-(.+)$/);
  if (bgMatch) {
    const colorKey = bgMatch[1];
    if (colorKey && colorMap[colorKey]) {
      return { backgroundColor: colorMap[colorKey] };
    }
  }
  
  const borderColorMatch = cls.match(/^border-(.+)$/);
  if (borderColorMatch) {
    const colorKey = borderColorMatch[1];
    if (colorKey && colorMap[colorKey]) {
      return { borderColor: colorMap[colorKey] };
    }
  }
  
  if (cls === "inset-0") return { top: 0, right: 0, bottom: 0, left: 0 };
  
  const posMatch = cls.match(/^(top|right|bottom|left)-(\d+)$/);
  if (posMatch) {
    const dir = posMatch[1];
    const size = posMatch[2];
    if (dir && size) {
      const value = spacingMap[size] ?? parseInt(size, 10) * 4;
      return { [dir]: value };
    }
  }
  
  const negMatch = cls.match(/^-m([lrtbxy]?)-(\d+)$/);
  if (negMatch) {
    const dir = negMatch[1] ?? "";
    const size = negMatch[2];
    if (size) {
      const value = -(spacingMap[size] ?? parseInt(size, 10) * 4);
      switch (dir) {
        case "l": return { marginLeft: value };
        case "r": return { marginRight: value };
        case "t": return { marginTop: value };
        case "b": return { marginBottom: value };
        case "x": return { marginHorizontal: value };
        case "y": return { marginVertical: value };
        default: return { margin: value };
      }
    }
  }
  
  return {};
}

export const commonStyles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
