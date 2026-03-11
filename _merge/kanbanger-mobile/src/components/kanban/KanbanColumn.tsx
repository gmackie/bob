import { View, Text, ScrollView, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { KanbanCard, KanbanCardGhost, type KanbanCardData } from "./KanbanCard";
import { tw } from "../../lib/styles";
import { useTheme } from "../../lib/theme";

interface KanbanColumnProps {
  title: string;
  status: string;
  issues: KanbanCardData[];
  onCardPress: (issueId: string) => void;
  onDragStart?: (issueId: string, y: number) => void;
  onDragMove?: (issueId: string, y: number) => void;
  onDragEnd?: (issueId: string) => void;
  showGhost?: boolean;
  isPortrait?: boolean;
  columnWidth?: number;
  onLayout?: (status: string, y: number, height: number) => void;
}

const statusColors: Record<string, string> = {
  backlog: "#9CA3AF",
  todo: "#6B7280",
  in_progress: "#3B82F6",
  in_review: "#8B5CF6",
  done: "#22C55E",
  canceled: "#EF4444",
};

export function KanbanColumn({
  title,
  status,
  issues,
  onCardPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  showGhost = false,
  isPortrait = false,
  columnWidth,
  onLayout,
}: KanbanColumnProps) {
  const { colors, isDark } = useTheme();
  const { height } = useWindowDimensions();

  const containerStyle = isPortrait
    ? { width: "100%" as const, minHeight: 120 }
    : { width: columnWidth ?? 280, maxHeight: height - 200 };

  const handleLayout = (event: LayoutChangeEvent) => {
    if (onLayout) {
      const { y, height: h } = event.nativeEvent.layout;
      onLayout(status, y, h);
    }
  };

  return (
    <View
      testID={`kanban-column-${status}`}
      onLayout={handleLayout}
      style={[
        tw("rounded-lg"),
        isPortrait ? tw("mb-3") : tw("mr-3"),
        {
          ...containerStyle,
          backgroundColor: showGhost 
            ? (isDark ? colors["indigo-900"] : colors["indigo-100"])
            : (isDark ? colors.surfaceHighlight : colors["gray-50"]),
          borderWidth: showGhost ? 2 : 0,
          borderColor: showGhost ? colors.primary : undefined,
          borderStyle: showGhost ? "dashed" as const : undefined,
        },
      ]}
    >
      <View style={tw("flex-row items-center gap-2 px-3 py-2")}>
        <View
          style={[
            tw("h-2 w-2 rounded-full"),
            { backgroundColor: statusColors[status] ?? "#9CA3AF" },
          ]}
        />
        <Text style={[tw("text-sm font-semibold"), { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
          {issues.length}
        </Text>
      </View>

      {isPortrait ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={tw("px-2 pb-2")}
        >
          {showGhost && <KanbanCardGhost />}
          {issues.map((issue) => (
            <View key={issue.id} style={tw("mr-2")}>
              <KanbanCard
                data={issue}
                onPress={() => onCardPress(issue.id)}
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            </View>
          ))}
          {issues.length === 0 && !showGhost && (
            <View style={tw("items-center justify-center px-8 py-4")}>
              <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                No issues
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={{ maxHeight: height - 200 }}
          contentContainerStyle={tw("px-2 pb-2")}
          showsVerticalScrollIndicator={false}
        >
          {showGhost && <KanbanCardGhost />}
          {issues.map((issue) => (
            <KanbanCard
              key={issue.id}
              data={issue}
              onPress={() => onCardPress(issue.id)}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          ))}
          {issues.length === 0 && !showGhost && (
            <View style={tw("items-center py-8")}>
              <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                No issues
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
