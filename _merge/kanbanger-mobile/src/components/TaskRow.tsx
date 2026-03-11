import React from "react";
import { View, Text, Pressable } from "react-native";
import { Avatar, AvatarFallback, AvatarFallbackText, Badge, BadgeText } from "@linear-clone/ui-native";
import { AgentBadge } from "./AgentStatusIndicator";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type TaskPriority = "no_priority" | "urgent" | "high" | "medium" | "low";

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

interface TaskRowProps {
  task: {
    id: string;
    identifier: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee?: {
      id: string;
      name: string | null;
      avatarUrl: string | null;
      isAgent?: boolean;
    } | null;
    labels?: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    funnelArtifactType?: string | null;
    funnelStage?: string | null;
  };
  onPress?: () => void;
  isSelected?: boolean;
  dense?: boolean;
  showFunnelMiniBar?: boolean;
}

const funnelArtifactLabels: Record<string, string> = {
  idea: "Idea",
  plan: "Plan",
  brd: "BRD",
  spec: "Spec",
  task: "Task",
  pr: "PR",
  release: "Release",
};

const funnelStageLabels: Record<string, string> = {
  dumped: "Dumped",
  triaged: "Triaged",
  planned: "Planned",
  designed: "Designed",
  ready_for_execution: "Ready",
  picked_up: "Picked up",
  staging_deployed: "Staging",
  staging_verified: "Verified",
  production_deployed: "Production",
};

const funnelStageOrder = [
  "dumped",
  "triaged",
  "planned",
  "designed",
  "ready_for_execution",
  "picked_up",
  "staging_deployed",
  "staging_verified",
  "production_deployed",
] as const;

const formatFunnelArtifact = (artifactType: string | null | undefined) =>
  artifactType ? (funnelArtifactLabels[artifactType] ?? artifactType.replace(/_/g, " ")) : null;

const formatFunnelStage = (stage: string | null | undefined) =>
  stage ? (funnelStageLabels[stage] ?? stage.replace(/_/g, " ")) : null;

export function TaskRow({
  task,
  onPress,
  isSelected,
  dense = false,
  showFunnelMiniBar = true,
}: TaskRowProps) {
  const { colors, isDark } = useTheme();

  const initials = task.assignee?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "?";

  const getStatusColor = (status: TaskStatus) => {
    const bgMap: Record<TaskStatus, string> = {
      backlog: isDark ? colors["gray-800"] : colors["gray-100"],
      todo: isDark ? colors["gray-700"] : colors["gray-200"],
      in_progress: isDark ? colors["blue-700"] : colors["blue-100"],
      in_review: isDark ? "#4C1D95" : "#F3E8FF", 
      done: isDark ? colors["green-900"] : colors["green-100"],
      canceled: isDark ? colors["red-900"] : colors["red-100"],
    };
    return bgMap[status];
  };

  const getPriorityColor = (priority: TaskPriority) => {
    if (priority === "no_priority") return isDark ? colors["gray-800"] : colors["gray-100"];
    const map: Record<string, string> = {
      urgent: colors["red-500"],
      high: colors["orange-500"],
      medium: colors["yellow-500"],
      low: colors["blue-500"],
    };
    return map[priority];
  };

  const getStatusTextColor = (status: TaskStatus) => {
    if (isDark) {
       if (status === "todo") return colors["gray-300"];
       if (status === "backlog") return colors["gray-400"];
       return colors.white;
    }
    return colors["gray-700"];
  };

  const artifactLabel = formatFunnelArtifact(task.funnelArtifactType);
  const stageLabel = formatFunnelStage(task.funnelStage);
  const normalizedStage = funnelStageOrder.find((stage) => stage === task.funnelStage);
  const stageIndex = normalizedStage ? funnelStageOrder.indexOf(normalizedStage) : -1;

  return (
    <Pressable
      testID={`task-row-${task.id}`}
      accessibilityLabel={`Task ${task.identifier}: ${task.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        tw(`flex-row items-center px-4 ${dense ? "py-2" : "py-3"} border-b`),
        { 
          backgroundColor: isSelected 
            ? (isDark ? colors["indigo-900"] : colors["indigo-100"]) 
            : colors.surface,
          borderColor: colors.border
        },
        isSelected && { borderLeftWidth: 4, borderLeftColor: colors.primary },
        pressed && { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-50"] }
      ]}
    >
      {task.priority !== "no_priority" && (
        <View style={[tw("h-2 w-2 rounded-full mr-3"), { backgroundColor: getPriorityColor(task.priority) }]} />
      )}

      <View style={tw("flex-1")}>
        <Text
          testID={`task-identifier-${task.id}`}
          style={[tw(`text-xs font-mono ${dense ? "mb-0.5" : "mb-1"}`), { color: colors.textSecondary }]}
        >
          {task.identifier}
        </Text>

        <Text
          testID={`task-title-${task.id}`}
          style={[tw("text-sm font-medium"), { color: colors.text }]}
          numberOfLines={dense ? 1 : 2}
        >
          {task.title}
        </Text>

        <View style={tw(`flex-row items-center ${dense ? "mt-1.5" : "mt-2"} flex-wrap gap-1`)}>
          <Badge style={{ backgroundColor: getStatusColor(task.status), paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
            <BadgeText style={{ fontSize: 12, color: getStatusTextColor(task.status) }}>{statusLabels[task.status]}</BadgeText>
          </Badge>
          {artifactLabel && (
            <Badge style={{ backgroundColor: isDark ? "#312e81" : "#e0e7ff", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
              <BadgeText style={{ color: isDark ? colors["indigo-300"] : "#3730a3", fontSize: 12 }}>
                {artifactLabel}
              </BadgeText>
            </Badge>
          )}
          {stageLabel && (
            <Badge style={{ backgroundColor: isDark ? "#0f172a" : "#e2e8f0", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
              <BadgeText style={{ color: isDark ? colors["gray-200"] : colors["gray-600"], fontSize: 12 }}>
                {stageLabel}
              </BadgeText>
            </Badge>
          )}
          {task.assignee?.isAgent && (
            <AgentBadge
              isAgent={true}
              isWorking={task.status === "in_progress"}
            />
          )}
          {task.labels?.slice(0, 2).map((label) => (
            <Badge
              key={label.id}
              style={{ backgroundColor: `${label.color}20`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}
            >
              <BadgeText style={{ color: label.color, fontSize: 12 }}>
                {label.name}
              </BadgeText>
            </Badge>
          ))}
        </View>

        {showFunnelMiniBar && stageIndex >= 0 && (
          <View style={[tw(`${dense ? "mt-1.5" : "mt-2"} flex-row gap-0.5`), { width: dense ? 96 : 120 }]}>
            {funnelStageOrder.map((stage, index) => {
              const isCurrent = index === stageIndex;
              const isComplete = index < stageIndex;
              return (
                <View
                  key={stage}
                  style={{
                    flex: 1,
                    height: dense ? 2 : 3,
                    borderRadius: 9999,
                    backgroundColor: isCurrent
                      ? (isDark ? "#312e81" : "#3b82f6")
                      : isComplete
                        ? (isDark ? "#059669" : "#10b981")
                        : (isDark ? colors["gray-700"] : colors["gray-300"]),
                  }}
                />
              );
            })}
          </View>
        )}
      </View>

      {task.assignee && (
        <Avatar style={{ height: dense ? 28 : 32, width: dense ? 28 : 32, marginLeft: 12 }}>
          <AvatarFallback style={{ backgroundColor: isDark ? colors["indigo-900"] : colors["indigo-100"] }}>
            <AvatarFallbackText style={{ fontSize: 12, color: isDark ? colors["indigo-300"] : colors["indigo-600"] }}>{initials}</AvatarFallbackText>
          </AvatarFallback>
        </Avatar>
      )}
    </Pressable>
  );
}
