import { useState, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { TaskRow, type TaskStatus, type TaskPriority } from "../components/TaskRow";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { TaskDetailScreen } from "./TaskDetailScreen";
import { SplitView } from "../components/SplitView";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

type StatusFilter = "active" | "backlog" | "closed" | "all";
type TaskMode = "tasks" | "ideas";
type FunnelArtifactFilter = "all" | "idea" | "plan" | "brd" | "spec" | "task" | "pr" | "release";
type FunnelStageFilter =
  | "all"
  | "dumped"
  | "triaged"
  | "planned"
  | "designed"
  | "ready_for_execution"
  | "picked_up"
  | "staging_deployed"
  | "staging_verified"
  | "production_deployed";

const funnelArtifactLabels: Record<FunnelArtifactFilter, string> = {
  all: "All Artifacts",
  idea: "Idea",
  plan: "Plan",
  brd: "BRD",
  spec: "Spec",
  task: "Task",
  pr: "PR",
  release: "Release",
};

const funnelStageLabels: Record<FunnelStageFilter, string> = {
  all: "All Stages",
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

export function TasksSplitViewScreen() {
  const { workspaceId, teamId, teamName } = useWorkspace();
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const isCompact = width < 380;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [taskMode, setTaskMode] = useState<TaskMode>("ideas");
  const [artifactFilter, setArtifactFilter] = useState<FunnelArtifactFilter>("all");
  const [stageFilter, setStageFilter] = useState<FunnelStageFilter>("all");
  const [denseMode, setDenseMode] = useState(false);
  const [showMiniBarsInDense, setShowMiniBarsInDense] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const getStatusFilter = (): TaskStatus[] | undefined => {
    switch (statusFilter) {
      case "active":
        return ["todo", "in_progress", "in_review"];
      case "backlog":
        return ["backlog"];
      case "closed":
        return ["done", "canceled"];
      default:
        return undefined;
    }
  };

  const { data: tasks, isLoading, refetch, isRefetching } = trpc.issue.list.useQuery(
    {
      workspaceId,
      filter: {
        teamId,
        ...(taskMode === "ideas"
          ? {
              status: ["backlog", "todo", "in_progress", "in_review", "done"] as TaskStatus[],
              funnelArtifactType: artifactFilter === "all" ? undefined : [artifactFilter],
              funnelStage: stageFilter === "all" ? undefined : [stageFilter],
            }
          : {
              status: getStatusFilter(),
            }),
      },
    },
    { enabled: !!workspaceId && !!teamId }
  );

  const taskModeTabs: { key: TaskMode; label: string }[] = [
    { key: "tasks", label: "Tasks" },
    { key: "ideas", label: "Ideas" },
  ];

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "backlog", label: "Backlog" },
    { key: "closed", label: "Closed" },
    { key: "all", label: "All" },
  ];

  const funnelArtifactFilterOptions: FunnelArtifactFilter[] = [
    "all",
    "idea",
    "plan",
    "brd",
    "spec",
    "task",
    "pr",
    "release",
  ];

  const funnelStageFilterOptions: FunnelStageFilter[] = [
    "all",
    "dumped",
    "triaged",
    "planned",
    "designed",
    "ready_for_execution",
    "picked_up",
    "staging_deployed",
    "staging_verified",
    "production_deployed",
  ];

  const getEmptyStateMessage = () => {
    if (taskMode === "ideas") {
      return "No ideas found for this funnel view.";
    }
    if (statusFilter === "active") return "No active tasks";
    if (statusFilter === "backlog") return "No tasks in backlog";
    if (statusFilter === "closed") return "No closed tasks";
    return "No tasks yet";
  };

  const chipMargin = isCompact ? 6 : 8;
  const modeChipFontSize = isCompact ? 12 : 13;
  const modeChipPadX = isCompact ? 10 : 12;
  const renderModeTabs = () => (
    <View style={tw("flex-row mt-3 gap-2")}> 
      {taskModeTabs.map((tab) => (
        <Pressable
          key={tab.key}
          testID={`tasks-mode-${tab.key}`}
          onPress={() => setTaskMode(tab.key)}
          style={{
            borderRadius: 9999,
            paddingHorizontal: modeChipPadX,
            paddingVertical: 6,
            backgroundColor: taskMode === tab.key ? colors.text : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
          }}
        >
          <Text
            style={{
              fontSize: modeChipFontSize,
              color: taskMode === tab.key ? (isDark ? colors["gray-900"] : colors.white) : colors.textSecondary,
            }}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const renderFilterChips = (
    options: Array<string>,
    selected: string,
    onSelect: (value: string) => void,
    labels: Record<string, string>
  ) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingVertical: 2, paddingRight: 16 }}
      style={{ marginTop: 10 }}
    >
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            style={{
              marginRight: chipMargin,
              borderRadius: 9999,
              paddingHorizontal: modeChipPadX,
              paddingVertical: 6,
              backgroundColor: option === selected ? colors.primary : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
            }}
        >
          <Text
            style={{
              fontSize: modeChipFontSize,
              color: option === selected ? colors.primaryForeground : colors.textSecondary,
            }}
          >
            {labels[option] ?? option}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const renderToggleChip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 9999,
        paddingHorizontal: modeChipPadX,
        paddingVertical: 6,
        backgroundColor: active ? colors.primary : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
      }}
    >
      <Text style={{ fontSize: modeChipFontSize, color: active ? colors.primaryForeground : colors.textSecondary }}>
        {label}
      </Text>
    </Pressable>
  );

  const handleTaskPress = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  const handleTaskCreated = useCallback((taskId: string) => {
    setShowCreateModal(false);
    setSelectedTaskId(taskId);
  }, []);

  const masterContent = (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]}>
      <View style={[tw("border-b px-4 py-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[tw(`${isCompact ? "text-lg" : "text-xl"} font-bold`), { color: colors.text }]}>
          {teamName} {taskMode === "ideas" ? "Ideas" : "Tasks"}
        </Text>

        {renderModeTabs()}
        {taskMode === "tasks" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tw("mt-3")}>
            <View style={tw("flex-row gap-2")}>
              {filterTabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  onPress={() => setStatusFilter(tab.key)}
                  style={{
                    borderRadius: 9999,
                    paddingHorizontal: modeChipPadX,
                    paddingVertical: 6,
                    backgroundColor: statusFilter === tab.key ? colors.text : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
                  }}
                >
                  <Text
                    style={{
                      fontSize: modeChipFontSize,
                      color: statusFilter === tab.key ? (isDark ? colors["gray-900"] : colors.white) : colors.textSecondary,
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <>
            {renderFilterChips(
              funnelArtifactFilterOptions,
              artifactFilter,
              (value) => setArtifactFilter(value as FunnelArtifactFilter),
              funnelArtifactLabels
            )}
            {renderFilterChips(
              funnelStageFilterOptions,
              stageFilter,
              (value) => setStageFilter(value as FunnelStageFilter),
              funnelStageLabels
            )}
          </>
        )}

        <View style={tw("flex-row mt-3 gap-2")}>
          {renderToggleChip(denseMode ? "Dense: On" : "Dense: Off", denseMode, () => setDenseMode((value) => !value))}
          {denseMode &&
            renderToggleChip(
              showMiniBarsInDense ? "Mini-bars: On" : "Mini-bars: Off",
              showMiniBarsInDense,
              () => setShowMiniBarsInDense((value) => !value)
            )}
        </View>
      </View>

      {isLoading ? (
        <View style={tw("flex-1 items-center justify-center")}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={tw("flex-1")}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          {tasks && tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={{
                  id: task.id,
                  identifier: task.identifier,
                  title: task.title,
                  status: task.status as TaskStatus,
                  priority: task.priority as TaskPriority,
                  assignee: task.assignee,
                  labels: task.labels,
                  funnelArtifactType: (task as { funnelArtifactType?: string | null }).funnelArtifactType,
                  funnelStage: (task as { funnelStage?: string | null }).funnelStage,
                }}
                onPress={() => handleTaskPress(task.id)}
                isSelected={selectedTaskId === task.id}
                dense={denseMode}
                showFunnelMiniBar={!denseMode || showMiniBarsInDense}
              />
            ))
          ) : (
            <View style={tw("items-center justify-center py-16")}>
              <Text style={[tw("text-base"), { color: colors.textSecondary }]}>No tasks found</Text>
              <Text style={[tw("text-sm mt-1"), { color: colors.textTertiary }]}>
                {getEmptyStateMessage()}
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <Pressable
        onPress={() => setShowCreateModal(true)}
        style={[
          tw("absolute rounded-full items-center justify-center shadow-lg"),
          { bottom: 24, right: 24, width: 56, height: 56, elevation: 4, backgroundColor: colors.primary, shadowColor: colors.text }
        ]}
      >
        <Text style={[tw("text-2xl font-light"), { color: colors.primaryForeground }]}>+</Text>
      </Pressable>

      <CreateTaskModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onTaskCreated={handleTaskCreated}
      />
    </View>
  );

  const detailContent = (
    <TaskDetailScreen
      taskId={selectedTaskId ?? undefined}
      onBack={() => setSelectedTaskId(null)}
    />
  );

  return <SplitView master={masterContent} detail={detailContent} />;
}
