import { View, Text, Pressable } from "react-native";
import { ProgressRing } from "./ProgressRing";
import { tw, colors as palette } from "../lib/styles";
import { useTheme } from "../lib/theme";

type HealthStatus = "on_track" | "at_risk" | "behind";

interface ProjectHealthCardProps {
  project: {
    id: string;
    name: string;
    color: string | null;
    status: string;
  };
  issueCount: number;
  completedCount: number;
  overdueCount?: number;
  blockedCount?: number;
  onPress?: () => void;
}

const healthColors: Record<HealthStatus, { light: { bg: string; text: string }; dark: { bg: string; text: string }; dot: string }> = {
  on_track: { 
    light: { bg: "#F0FDF4", text: palette["green-600"] },
    dark: { bg: "#166534", text: "#86EFAC" },
    dot: palette["green-500"]
  },
  at_risk: { 
    light: { bg: "#FEFCE8", text: "#A16207" },
    dark: { bg: "#854D0E", text: "#FDE047" },
    dot: palette["yellow-500"]
  },
  behind: { 
    light: { bg: palette["red-50"], text: palette["red-600"] },
    dark: { bg: "#991B1B", text: "#FCA5A5" },
    dot: palette["red-500"]
  },
};

const healthLabels: Record<HealthStatus, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  behind: "Behind",
};

function calculateHealth(
  completedCount: number,
  issueCount: number,
  overdueCount: number,
  blockedCount: number
): HealthStatus {
  if (overdueCount > 3 || blockedCount > 2) return "behind";
  if (overdueCount > 0 || (issueCount > 0 && completedCount / issueCount < 0.3)) return "at_risk";
  return "on_track";
}

export function ProjectHealthCard({
  project,
  issueCount,
  completedCount,
  overdueCount = 0,
  blockedCount = 0,
  onPress,
}: ProjectHealthCardProps) {
  const { colors, isDark } = useTheme();
  const progress = issueCount > 0 ? Math.round((completedCount / issueCount) * 100) : 0;
  const health = calculateHealth(completedCount, issueCount, overdueCount, blockedCount);
  const healthConfig = healthColors[health];
  const healthStyle = isDark ? healthConfig.dark : healthConfig.light;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        tw("mr-3 rounded-xl border p-4 shadow-sm"),
        { 
          backgroundColor: colors.surface,
          borderColor: colors.border,
          width: 160, 
          minHeight: 160 
        },
        pressed && { transform: [{ scale: 0.98 }] }
      ]}
    >
      <View style={tw("flex-row items-start justify-between")}>
        <View
          style={[
            tw("h-8 w-8 items-center justify-center rounded-lg"),
            { backgroundColor: `${project.color ?? "#6366f1"}20` }
          ]}
        >
          <Text
            style={[tw("text-sm font-bold"), { color: project.color ?? "#6366f1" }]}
          >
            {project.name.charAt(0)}
          </Text>
        </View>

        <View style={[tw("flex-row items-center rounded-full px-2"), { backgroundColor: healthStyle.bg, paddingVertical: 2 }]}>
          <View style={[tw("mr-1 h-1 w-1 rounded-full"), { backgroundColor: healthConfig.dot }]} />
          <Text style={[tw("text-xs font-medium"), { color: healthStyle.text }]}>
            {healthLabels[health]}
          </Text>
        </View>
      </View>

      <Text style={[tw("mt-2 text-sm font-semibold"), { color: colors.text }]} numberOfLines={2}>
        {project.name}
      </Text>

      <View style={tw("mt-3 flex-1 items-center justify-center")}>
        <ProgressRing
          progress={progress}
          size="sm"
          color={project.color ?? "#4F46E5"}
        />
      </View>

      <View style={tw("mt-2 flex-row justify-between")}>
        <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
          {completedCount}/{issueCount}
        </Text>
        {overdueCount > 0 && (
          <Text style={[tw("text-xs"), { color: colors.danger }]}>
            {overdueCount} overdue
          </Text>
        )}
      </View>
    </Pressable>
  );
}
