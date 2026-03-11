import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  useWindowDimensions,
  Pressable,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import { KanbanColumn, type KanbanCardData } from "../components/kanban";
import { FilterDropdown, type FilterOption } from "../components/kanban/FilterDropdown";
import type { RootTabParamList, TasksStackParamList } from "../navigation/types";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

type BoardNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, "Board">,
  NativeStackNavigationProp<TasksStackParamList>
>;

const STATUS_ORDER = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

type ViewMode = "kanban" | "list";
type ColumnLayout = { y: number; height: number };

export function KanbanBoardScreen() {
  const navigation = useNavigation<BoardNavigationProp>();
  const { workspaceId, userId } = useWorkspace();
  const { colors, isDark } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<FilterOption>({
    id: "my_tasks",
    label: "My Tasks",
    type: "my_tasks",
  });
  
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const columnLayouts = useRef<Record<string, ColumnLayout>>({});
  const scrollOffset = useRef(0);

  useEffect(() => {
    console.log("[KanbanBoard] userId:", userId, "workspaceId:", workspaceId, "filter:", filter.type);
  }, [userId, workspaceId, filter.type]);

  const { data: projectsData } = trpc.project.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );

  const filterOptions = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [
      { id: "my_tasks", label: "My Tasks", type: "my_tasks" },
      { id: "all", label: "All Issues", type: "all" },
    ];
    if (projectsData) {
      for (const p of projectsData) {
        options.push({
          id: p.project.id,
          label: p.project.name,
          type: "project",
          color: p.project.color,
        });
      }
    }
    return options;
  }, [projectsData]);

  const queryParams = useMemo(() => {
    const base = { workspaceId };
    if (filter.type === "my_tasks" && userId) {
      return { ...base, filter: { assigneeId: userId } };
    }
    if (filter.type === "project") {
      return { ...base, filter: { projectId: filter.id } };
    }
    return base;
  }, [workspaceId, userId, filter]);

  const {
    data: issues,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.issue.list.useQuery(queryParams, { enabled: !!workspaceId });

  const updateIssueMutation = trpc.issue.update.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  useEffect(() => {
    console.log("[KanbanBoard] Query:", JSON.stringify(queryParams), "Issues:", issues?.length ?? 0);
  }, [queryParams, issues]);

  const issuesByStatus = useMemo(() => {
    const grouped: Record<string, KanbanCardData[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      canceled: [],
    };
    if (issues) {
      for (const issue of issues) {
        const status = issue.status;
        if (grouped[status]) {
          grouped[status]!.push({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            priority: issue.priority,
            status: issue.status,
            dueDate: issue.dueDate,
            projectColor: issue.project.color,
          });
        }
      }
    }
    return grouped;
  }, [issues]);

  const handleCardPress = useCallback((issueId: string) => {
    navigation.navigate("Tasks", {
      screen: "TaskDetail",
      params: { taskId: issueId },
    });
  }, [navigation]);

  const handleColumnLayout = useCallback((status: string, y: number, height: number) => {
    columnLayouts.current[status] = { y, height };
  }, []);

  const findTargetColumn = useCallback((absoluteY: number): string | null => {
    const adjustedY = absoluteY - 150 + scrollOffset.current;
    
    for (const status of STATUS_ORDER) {
      const layout = columnLayouts.current[status];
      if (layout) {
        if (adjustedY >= layout.y && adjustedY <= layout.y + layout.height) {
          return status;
        }
      }
    }
    return null;
  }, []);

  const handleDragStart = useCallback((issueId: string, absoluteY: number) => {
    setDraggingCardId(issueId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const handleDragMove = useCallback((issueId: string, absoluteY: number) => {
    const target = findTargetColumn(absoluteY);
    const draggedCard = issues?.find(i => i.id === issueId);
    
    if (target && target !== draggedCard?.status && target !== targetStatus) {
      setTargetStatus(target);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (!target || target === draggedCard?.status) {
      setTargetStatus(null);
    }
  }, [findTargetColumn, issues, targetStatus]);

  const handleDragEnd = useCallback((issueId: string) => {
    const draggedCard = issues?.find(i => i.id === issueId);
    
    if (targetStatus && draggedCard && targetStatus !== draggedCard.status) {
      updateIssueMutation.mutate({
        id: issueId,
        status: targetStatus as typeof STATUS_ORDER[number],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    
    setDraggingCardId(null);
    setTargetStatus(null);
  }, [issues, targetStatus, updateIssueMutation]);

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === "kanban" ? "list" : "kanban");
  }, []);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
  }, []);

  const columnWidth = isLandscape
    ? (windowWidth - 48) / 5
    : windowWidth * 0.75;

  if (isLoading) {
    return (
      <View
        style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[tw("mt-2"), { color: colors.textSecondary }]}>Loading board...</Text>
      </View>
    );
  }

  const isPortrait = !isLandscape;

  return (
    <View
      testID="kanban-board-screen"
      style={[tw("flex-1"), { backgroundColor: colors.background }]}
    >
      <View
        style={[
          tw("flex-row items-center justify-between border-b px-4 py-3"),
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text testID="board-header" style={[tw("text-xl font-bold"), { color: colors.text }]}>
          Board
        </Text>
        <View style={tw("flex-row items-center gap-2")}>
          <Pressable
            testID="view-toggle"
            onPress={toggleViewMode}
            style={[
              tw("h-8 w-8 items-center justify-center rounded-md"),
              { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"] },
            ]}
          >
            <Ionicons
              name={viewMode === "kanban" ? "list-outline" : "grid-outline"}
              size={18}
              color={colors.text}
            />
          </Pressable>
          <FilterDropdown
            options={filterOptions}
            selected={filter}
            onSelect={setFilter}
          />
        </View>
      </View>

      {viewMode === "list" ? (
        <ScrollView
          testID="list-view"
          style={tw("flex-1")}
          contentContainerStyle={tw("p-4")}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {issues && issues.length > 0 ? (
            issues.map((issue) => (
              <Pressable
                key={issue.id}
                testID={`list-item-${issue.id}`}
                onPress={() => handleCardPress(issue.id)}
                style={[
                  tw("flex-row items-center p-3 rounded-lg mb-2 border"),
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View
                  style={[
                    tw("h-2 w-2 rounded-full mr-3"),
                    { backgroundColor: issue.project.color ?? colors.primary },
                  ]}
                />
                <View style={tw("flex-1")}>
                  <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                    {issue.identifier}
                  </Text>
                  <Text style={[tw("text-sm"), { color: colors.text }]} numberOfLines={1}>
                    {issue.title}
                  </Text>
                </View>
                <View
                  style={[
                    tw("px-2 py-1 rounded"),
                    { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"] },
                  ]}
                >
                  <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                    {STATUS_LABELS[issue.status] ?? issue.status}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={tw("items-center justify-center py-16")}>
              <Text style={[tw("text-base"), { color: colors.textSecondary }]}>
                No issues found
              </Text>
              <Text style={[tw("text-sm mt-1"), { color: colors.textTertiary }]}>
                {filter.type === "my_tasks" ? "No tasks assigned to you" : "Try a different filter"}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : isPortrait ? (
        <ScrollView
          testID="kanban-scroll-portrait"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={tw("p-4")}
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
          {STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              title={STATUS_LABELS[status] ?? status}
              status={status}
              issues={issuesByStatus[status] ?? []}
              onCardPress={handleCardPress}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              showGhost={targetStatus === status}
              isPortrait={true}
              onLayout={handleColumnLayout}
            />
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          testID="kanban-scroll-landscape"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={tw("p-4")}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {STATUS_ORDER.map((status) => (
            <KanbanColumn
              key={status}
              title={STATUS_LABELS[status] ?? status}
              status={status}
              issues={issuesByStatus[status] ?? []}
              onCardPress={handleCardPress}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              showGhost={targetStatus === status}
              isPortrait={false}
              columnWidth={columnWidth}
              onLayout={handleColumnLayout}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
