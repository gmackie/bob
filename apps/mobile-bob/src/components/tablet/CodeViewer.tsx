import { Text, View, ScrollView } from "react-native";

import { colors } from "~/lib/colors";

interface CodeViewerProps {
  content: string;
  filePath: string;
  startLine?: number;
}

export function CodeViewer({ content, filePath, startLine = 1 }: CodeViewerProps) {
  const lines = content.split("\n");
  // Detect if this is line-numbered output (e.g., "  1\tconst foo = ...")
  const isNumbered = lines.length > 0 && /^\s*\d+\t/.test(lines[0]!);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* File header */}
      <View
        className="flex-row items-center px-3 py-2"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card }}
      >
        <Text className="text-xs font-mono text-accent" numberOfLines={1}>
          {filePath}
        </Text>
      </View>

      <ScrollView className="flex-1" horizontal>
        <ScrollView className="flex-1">
          <View className="py-1">
            {lines.map((line, i) => {
              let lineNum: number;
              let lineContent: string;

              if (isNumbered) {
                const match = line.match(/^\s*(\d+)\t(.*)$/);
                if (match) {
                  lineNum = parseInt(match[1]!, 10);
                  lineContent = match[2]!;
                } else {
                  lineNum = startLine + i;
                  lineContent = line;
                }
              } else {
                lineNum = startLine + i;
                lineContent = line;
              }

              return (
                <View key={i} className="flex-row">
                  <View className="items-end pr-2" style={{ width: 48 }}>
                    <Text className="text-xs font-mono text-muted2">
                      {lineNum}
                    </Text>
                  </View>
                  <Text className="flex-1 text-xs font-mono leading-5 text-foreground">
                    {lineContent || " "}
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
