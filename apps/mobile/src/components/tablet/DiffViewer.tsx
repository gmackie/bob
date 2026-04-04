import { Text, View, ScrollView } from "react-native";

import { colors } from "~/lib/colors";

interface DiffViewerProps {
  diff: string;
  filePath?: string;
}

type LineType = "add" | "remove" | "context" | "header" | "meta";

function classifyLine(line: string): LineType {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "header";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "context";
}

const LINE_COLORS: Record<LineType, { bg: string; fg: string }> = {
  add: { bg: "#22c55e10", fg: colors.success },
  remove: { bg: "#ef444410", fg: colors.danger },
  context: { bg: "transparent", fg: colors.foreground },
  header: { bg: colors.primary + "10", fg: colors.primary },
  meta: { bg: "transparent", fg: colors.muted },
};

export function DiffViewer({ diff, filePath }: DiffViewerProps) {
  const lines = diff.split("\n");

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {filePath && (
        <View
          className="flex-row items-center px-3 py-2"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-xs font-mono" style={{ color: colors.accent }} numberOfLines={1}>
            {filePath}
          </Text>
        </View>
      )}

      <ScrollView className="flex-1" horizontal>
        <ScrollView className="flex-1">
          <View className="py-1">
            {lines.map((line, i) => {
              const type = classifyLine(line);
              const { bg, fg } = LINE_COLORS[type];

              return (
                <View key={i} className="flex-row" style={{ backgroundColor: bg }}>
                  <View className="items-center justify-center" style={{ width: 20 }}>
                    {type === "add" && (
                      <Text className="text-xs font-mono font-bold" style={{ color: colors.success }}>+</Text>
                    )}
                    {type === "remove" && (
                      <Text className="text-xs font-mono font-bold" style={{ color: colors.danger }}>-</Text>
                    )}
                  </View>
                  <Text className="flex-1 text-xs font-mono leading-5" style={{ color: fg }}>
                    {type === "add" || type === "remove" ? line.slice(1) : line}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
