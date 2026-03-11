import { useState, useRef, useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { TaskRow, type TaskStatus, type TaskPriority } from "../components/TaskRow";
import { CreateTaskModal } from "../components/CreateTaskModal";
import type { TasksStackParamList } from "../navigation/types";
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

export function TasksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
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
  
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const fabVisible = useRef(new Animated.Value(1)).current;
  
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentScrollY = event.nativeEvent.contentOffset.y;
    const scrollDiff = currentScrollY - lastScrollY.current;
    
    if (scrollDiff > 10 && currentScrollY > 50) {
      Animated.spring(fabVisible, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    } else if (scrollDiff < -10 || currentScrollY < 50) {
      Animated.spring(fabVisible, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 10,
      }).start();
    }
    
    lastScrollY.current = currentScrollY;
  }, [fabVisible]);

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
          style={({ pressed }) => [
            tw("px-3 rounded-full"),
            {
              paddingVertical: 6,
              paddingHorizontal: modeChipPadX,
              backgroundColor: taskMode === tab.key ? colors.text : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              tw("font-medium"),
              { color: taskMode === tab.key ? (isDark ? colors["gray-900"] : colors.white) : colors.textSecondary },
              { fontSize: modeChipFontSize },
            ]}
          >
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const renderFilterChips = (options: Array<string>, selected: string, onSelect: (value: string) => void, labels: Record<string, string>) => (
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
            backgroundColor: option === selected
              ? colors.primary
              : (isDark ? colors.surfaceHighlight : colors["gray-100"]),
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

  const handleTaskPress = (taskId: string) => {
    navigation.navigate("TaskDetail", { taskId });
  };

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]} testID="tasks-screen">
      <View style={[tw("border-b px-4 py-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}> 
        <Text
          testID="tasks-header"
          style={[
            tw(`${isCompact ? "text-lg" : "text-xl"} font-bold`),
            { color: colors.text },
          ]}
        >
          {teamName} {taskMode === "ideas" ? "Ideas" : "Tasks"}
        </Text>

        {renderModeTabs()}

        {taskMode === "tasks" ? (
          <View testID="tasks-filter-tabs" style={tw("mt-3")}> 
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}
            >
              <View style={tw("flex-row gap-2")}> 
                {filterTabs.map((tab) => (
                <Pressable
                  key={tab.key}
                  testID={`tasks-filter-${tab.key}`}
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
          </View>
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
        <View testID="tasks-loading" style={tw("flex-1 items-center justify-center")}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          testID="tasks-list"
          style={tw("flex-1")}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl 
              refreshing={isRefetching} 
              onRefresh={refetch} 
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
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
                  dense={denseMode}
                  showFunnelMiniBar={!denseMode || showMiniBarsInDense}
                />
              ))
            ) : (
              <View testID="tasks-empty" style={tw("items-center justify-center py-16")}> 
                <Text style={[tw("text-base"), { color: colors.textSecondary }]}>No tasks found</Text>
                <Text style={[tw("text-sm mt-1"), { color: colors.textTertiary }]}> 
                  {getEmptyStateMessage()}
                </Text>
              </View>
            )}
        </ScrollView>
      )}

      <Animated.View
        style={{
          position: "absolute",
          bottom: 24,
          right: 24,
          transform: [
            {
              translateY: fabVisible.interpolate({
                inputRange: [0, 1],
                outputRange: [100, 0],
              }),
            },
            {
              scale: fabVisible.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1],
              }),
            },
          ],
          opacity: fabVisible,
        }}
      >
        <Pressable
          testID="create-task-fab"
          onPress={() => setShowCreateModal(true)}
          style={[
            tw("w-14 h-14 rounded-full items-center justify-center shadow-lg"),
            { backgroundColor: colors.primary, elevation: 4, shadowColor: colors.text }
          ]}
        >
          <Text style={[tw("text-2xl font-light"), { color: colors.primaryForeground }]}>+</Text>
        </Pressable>
      </Animated.View>

      <CreateTaskModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onTaskCreated={(taskId: string) => {
          setShowCreateModal(false);
          handleTaskPress(taskId);
        }}
      />
    </View>
  );
}
