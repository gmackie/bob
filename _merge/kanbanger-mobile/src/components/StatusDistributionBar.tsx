import { View, Text } from "react-native";
import { tw, colors } from "../lib/styles";

interface StatusCounts {
  backlog: number;
  todo: number;
  in_progress: number;
  in_review: number;
  done: number;
  canceled: number;
}

interface StatusDistributionBarProps {
  counts: StatusCounts;
  showLabels?: boolean;
  showLegend?: boolean;
  height?: number;
}

const statusConfig = {
  backlog: { color: "#9CA3AF", label: "Backlog" },
  todo: { color: "#6B7280", label: "Todo" },
  in_progress: { color: "#3B82F6", label: "In Progress" },
  in_review: { color: "#8B5CF6", label: "In Review" },
  done: { color: "#10B981", label: "Done" },
  canceled: { color: "#EF4444", label: "Canceled" },
} as const;

type StatusKey = keyof typeof statusConfig;

export function StatusDistributionBar({
  counts,
  showLabels = false,
  showLegend = true,
  height = 8,
}: StatusDistributionBarProps) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  if (total === 0) {
    return (
      <View>
        <View
          style={[{ height }, tw("w-full rounded-full bg-gray-200")]}
        />
        {showLabels && (
          <Text style={tw("mt-1 text-center text-xs text-gray-400")}>
            No issues
          </Text>
        )}
      </View>
    );
  }

  const statusOrder: StatusKey[] = ["done", "in_review", "in_progress", "todo", "backlog", "canceled"];
  const segments = statusOrder
    .filter((status) => counts[status] > 0)
    .map((status) => ({
      status,
      count: counts[status],
      percentage: (counts[status] / total) * 100,
      ...statusConfig[status],
    }));

  return (
    <View>
      <View
        style={[{ height }, tw("w-full flex-row overflow-hidden rounded-full")]}
      >
        {segments.map((segment, index) => (
          <View
            key={segment.status}
            style={{
              width: `${segment.percentage}%`,
              backgroundColor: segment.color,
              borderTopLeftRadius: index === 0 ? height / 2 : 0,
              borderBottomLeftRadius: index === 0 ? height / 2 : 0,
              borderTopRightRadius: index === segments.length - 1 ? height / 2 : 0,
              borderBottomRightRadius: index === segments.length - 1 ? height / 2 : 0,
            }}
          />
        ))}
      </View>

      {showLegend && (
        <View style={[tw("mt-3 flex-row flex-wrap"), { gap: 8 }]}>
          {segments.map((segment) => (
            <View key={segment.status} style={tw("flex-row items-center")}>
              <View
                style={[{ backgroundColor: segment.color, marginRight: 6 }, tw("h-2 w-2 rounded-full")]}
              />
              <Text style={tw("text-xs text-gray-600")}>
                {segment.label}
              </Text>
              <Text style={tw("ml-1 text-xs font-medium text-gray-900")}>
                {segment.count}
              </Text>
            </View>
          ))}
        </View>
      )}

      {showLabels && (
        <View style={tw("mt-2 flex-row justify-between")}>
          <Text style={tw("text-xs text-gray-500")}>
            {counts.done} completed
          </Text>
          <Text style={tw("text-xs text-gray-500")}>
            {total - counts.done - counts.canceled} remaining
          </Text>
        </View>
      )}
    </View>
  );
}
