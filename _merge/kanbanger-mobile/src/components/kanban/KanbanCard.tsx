import { View, Text } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { tw } from "../../lib/styles";
import { useTheme } from "../../lib/theme";

export interface KanbanCardData {
  id: string;
  identifier: string;
  title: string;
  priority: string;
  status: string;
  dueDate: Date | null;
  projectColor: string | null;
}

interface KanbanCardProps {
  data: KanbanCardData;
  onPress: () => void;
  onDragStart?: (id: string, y: number) => void;
  onDragMove?: (id: string, y: number) => void;
  onDragEnd?: (id: string) => void;
  isDragTarget?: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: "#DC2626",
  high: "#F97316",
  medium: "#EAB308",
  low: "#3B82F6",
  no_priority: "#9CA3AF",
};

export function KanbanCard({
  data,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  isDragTarget = false,
}: KanbanCardProps) {
  const { colors, isDark } = useTheme();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const zIndex = useSharedValue(0);

  const formatDueDate = (date: Date | null): string | null => {
    if (!date) return null;
    const now = new Date();
    const due = new Date(date);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "Overdue";
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    return `${diffDays}d`;
  };

  const dueDateText = formatDueDate(data.dueDate);
  const isOverdue = data.dueDate && new Date(data.dueDate) < new Date();

  const panGesture = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart((event) => {
      scale.value = withSpring(1.05);
      opacity.value = 0.9;
      zIndex.value = 1000;
      if (onDragStart) {
        runOnJS(onDragStart)(data.id, event.absoluteY);
      }
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
      if (onDragMove) {
        runOnJS(onDragMove)(data.id, event.absoluteY);
      }
    })
    .onEnd(() => {
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
      scale.value = withSpring(1);
      opacity.value = 1;
      zIndex.value = 0;
      if (onDragEnd) {
        runOnJS(onDragEnd)(data.id);
      }
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onPress)();
  });

  const composedGesture = Gesture.Exclusive(panGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
    zIndex: zIndex.value,
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        testID={`kanban-card-${data.id}`}
        style={[
          tw("rounded-lg border p-3 mb-2"),
          {
            backgroundColor: colors.surface,
            borderColor: isDragTarget ? colors.primary : colors.border,
            borderWidth: isDragTarget ? 2 : 1,
            minWidth: 200,
          },
          animatedStyle,
        ]}
      >
        <View style={tw("flex-row items-center gap-2 mb-1")}>
          <View
            style={[
              tw("h-2 w-2 rounded-full"),
              { backgroundColor: priorityColors[data.priority] ?? priorityColors.no_priority },
            ]}
          />
          <Text style={[tw("text-xs font-medium"), { color: colors.textTertiary }]}>
            {data.identifier}
          </Text>
          {dueDateText && (
            <View
              style={[
                tw("rounded px-1.5 py-0.5"),
                {
                  backgroundColor: isOverdue
                    ? (isDark ? colors["red-900"] : colors["red-100"])
                    : (isDark ? colors["gray-700"] : colors["gray-100"]),
                },
              ]}
            >
              <Text
                style={[
                  tw("text-xs font-medium"),
                  { color: isOverdue ? colors.danger : colors.textSecondary },
                ]}
              >
                {dueDateText}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[tw("text-sm"), { color: colors.text }]}
          numberOfLines={2}
        >
          {data.title}
        </Text>
        {data.projectColor && (
          <View
            style={[
              tw("h-1 w-8 rounded-full mt-2"),
              { backgroundColor: data.projectColor },
            ]}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

export function KanbanCardGhost() {
  const { colors, isDark } = useTheme();

  return (
    <View
      style={[
        tw("rounded-lg border-2 border-dashed p-3 mb-2 items-center justify-center"),
        {
          backgroundColor: isDark ? colors.surfaceHighlight : colors["indigo-100"],
          borderColor: colors.primary,
          minWidth: 200,
          height: 80,
        },
      ]}
    >
      <Text style={[tw("text-xs font-medium"), { color: colors.primary }]}>
        Drop here
      </Text>
    </View>
  );
}
