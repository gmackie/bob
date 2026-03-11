import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  FlatList,
  StyleSheet,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@linear-clone/ui-native";
import { ProjectHealthCard } from "../components/ProjectHealthCard";
import { AgentStatusIndicator } from "../components/AgentStatusIndicator";
import type { RootTabParamList, TasksStackParamList, ProjectsStackParamList } from "../navigation/types";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

type HomeNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, "Home">,
  CompositeNavigationProp<
    NativeStackNavigationProp<TasksStackParamList>,
    NativeStackNavigationProp<ProjectsStackParamList>
  >
>;

type FilterType = "all" | "due_soon" | "in_progress";

interface DashboardTask {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  completedAt: Date | null;
  project: {
    id: string;
    name: string;
    key: string;
    color: string | null;
  };
}

export function HomeScreen() {
  const navigation = useNavigation<HomeNavigationProp>();
  const { workspaceId } = useWorkspace();
  const { colors, isDark } = useTheme();
  const [filter, setFilter] = useState<FilterType>("all");

  const {
    data: dashboard,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.issue.dashboard.useQuery(
    { workspaceId, dateRange: "week" },
    { enabled: !!workspaceId }
  );

  const {
    data: projects,
    refetch: refetchProjects,
  } = trpc.project.list.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );

  const {
    data: agentStats,
    refetch: refetchAgents,
  } = trpc.agent.getWorkspaceAgentStats.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );

  const handleTaskPress = (taskId: string) => {
    navigation.navigate("Tasks", {
      screen: "TaskDetail",
      params: { taskId },
    });
  };

  const handleProjectPress = (projectId: string) => {
    navigation.navigate("Projects", {
      screen: "ProjectDetail",
      params: { projectId },
    });
  };

  const handleRefresh = () => {
    refetch();
    refetchProjects();
    refetchAgents();
  };

  // Filter logic for tasks
  const getFilteredTasks = (): DashboardTask[] => {
    if (!dashboard) return [];
    switch (filter) {
      case "due_soon":
        return [...dashboard.overdue, ...dashboard.dueSoon];
      case "in_progress":
        return dashboard.inProgress;
      default:
        return [
          ...dashboard.inProgress,
          ...dashboard.overdue,
          ...dashboard.dueSoon,
        ];
    }
  };

  // Format due date with color coding
  const formatDueDate = (
    date: Date | null | undefined
  ): { text: string; color: string } | null => {
    if (!date) return null;
    const now = new Date();
    const due = new Date(date);
    const diffDays = Math.ceil(
      (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays < 0) return { text: "Overdue", color: colors.danger };
    if (diffDays === 0) return { text: "Today", color: colors.warning };
    if (diffDays === 1) return { text: "Tomorrow", color: colors.warning };
    return { text: `${diffDays}d`, color: colors.textSecondary };
  };

  const filteredTasks = getFilteredTasks();

  if (isLoading) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[tw("mt-2"), { color: colors.textSecondary }]}>Loading dashboard...</Text>
      </View>
    );
  }

  const inProgressCount = dashboard?.inProgress.length ?? 0;
  const overdueCount = dashboard?.overdue.length ?? 0;
  const completedCount = dashboard?.recentlyCompleted.length ?? 0;

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]} testID="home-screen">
      <ScrollView
        testID="home-scroll-view"
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <View style={tw("mb-2")}>
          <Text testID="home-title" style={[tw("text-3xl font-bold"), { color: colors.text }]}>Home</Text>
          <Text style={[tw("text-base"), { color: colors.textSecondary }]}>
            Your personal dashboard
          </Text>
        </View>

        <View testID="stats-cards" style={tw("flex-row gap-3")}>
          <View testID="stat-in-progress" style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>
              In Progress
            </Text>
            <Text testID="stat-in-progress-count" style={[tw("mt-1 text-2xl font-bold"), { color: colors.primary }]}>
              {inProgressCount}
            </Text>
          </View>

          <View testID="stat-overdue" style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>
              Overdue
            </Text>
            <Text testID="stat-overdue-count" style={[tw("mt-1 text-2xl font-bold"), { color: colors.danger }]}>
              {overdueCount}
            </Text>
          </View>

          <View testID="stat-done" style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>
              Done (7d)
            </Text>
            <Text testID="stat-done-count" style={[tw("mt-1 text-2xl font-bold"), { color: colors.success }]}>
              {completedCount}
            </Text>
          </View>
        </View>

        {projects && projects.length > 0 && (
          <View>
            <View style={tw("mb-2 flex-row items-center justify-between")}>
              <Text style={[tw("text-lg font-semibold"), { color: colors.text }]}>Projects</Text>
              <Pressable onPress={() => navigation.navigate("Projects", { screen: "ProjectsList" })}>
                <Text style={[tw("text-sm"), { color: colors.primary }]}>See all</Text>
              </Pressable>
            </View>
            <FlatList
              data={projects.slice(0, 5)}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.project.id}
              renderItem={({ item }) => (
                <ProjectHealthCard
                  project={item.project}
                  issueCount={item.issueCount}
                  completedCount={item.completedCount}
                  onPress={() => handleProjectPress(item.project.id)}
                />
              )}
              contentContainerStyle={{ paddingRight: 16 }}
            />
          </View>
        )}

        {agentStats && agentStats.agents.length > 0 && (
          <Card testID="agents-card" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <CardTitle style={{ color: colors.text }}>AI Agents</CardTitle>
              <CardDescription style={{ color: colors.textSecondary }}>
                {agentStats.activeNow} active, {agentStats.totalCompleted} completed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <View style={tw("gap-3")}>
                {agentStats.agents.slice(0, 3).map((agent) => (
                  <View key={agent.id} style={tw("flex-row items-center")}>
                    <AgentStatusIndicator
                      name={agent.name}
                      status={agent.isActive ? "working" : "idle"}
                      showStatus={true}
                      size="md"
                    />
                    <View style={tw("ml-3 flex-1")}>
                      <Text style={[tw("text-sm font-medium"), { color: colors.text }]}>
                        {agent.name ?? "Unnamed Agent"}
                      </Text>
                      <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                        {agent.completed} completed, {agent.inProgress} in progress
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </CardContent>
          </Card>
        )}

        <View testID="filter-chips" style={tw("flex-row gap-2")}>
          <Pressable
            testID="filter-all"
            onPress={() => setFilter("all")}
            style={[
              tw("rounded-full px-4 py-2"),
              { backgroundColor: filter === "all" ? colors.primary : (isDark ? colors.surfaceHighlight : colors["gray-200"]) }
            ]}
          >
            <Text
              style={[
                tw("text-sm font-medium"),
                { color: filter === "all" ? colors.primaryForeground : colors.textSecondary }
              ]}
            >
              All
            </Text>
          </Pressable>

          <Pressable
            testID="filter-due-soon"
            onPress={() => setFilter("due_soon")}
            style={[
              tw("rounded-full px-4 py-2"),
              { backgroundColor: filter === "due_soon" ? colors.primary : (isDark ? colors.surfaceHighlight : colors["gray-200"]) }
            ]}
          >
            <Text
              style={[
                tw("text-sm font-medium"),
                { color: filter === "due_soon" ? colors.primaryForeground : colors.textSecondary }
              ]}
            >
              Due Soon
            </Text>
          </Pressable>

          <Pressable
            testID="filter-in-progress"
            onPress={() => setFilter("in_progress")}
            style={[
              tw("rounded-full px-4 py-2"),
              { backgroundColor: filter === "in_progress" ? colors.primary : (isDark ? colors.surfaceHighlight : colors["gray-200"]) }
            ]}
          >
            <Text
              style={[
                tw("text-sm font-medium"),
                { color: filter === "in_progress" ? colors.primaryForeground : colors.textSecondary }
              ]}
            >
              In Progress
            </Text>
          </Pressable>
        </View>

        {/* My Tasks Card */}
        <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <CardHeader>
            <CardTitle style={{ color: colors.text }}>My Tasks</CardTitle>
            <CardDescription style={{ color: colors.textSecondary }}>
              {filteredTasks.length === 0
                ? "No tasks to show"
                : `${filteredTasks.length} task${filteredTasks.length === 1 ? "" : "s"}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredTasks.length === 0 ? (
              <View style={tw("items-center py-6")}>
                <Text style={{ color: colors.textTertiary }}>No tasks found</Text>
              </View>
            ) : (
              <View style={tw("gap-2")}>
                {filteredTasks.slice(0, 5).map((task) => {
                  const dueDateInfo = formatDueDate(task.dueDate);
                  return (
                    <Pressable
                      key={task.id}
                      onPress={() => handleTaskPress(task.id)}
                      style={({ pressed }) => [
                        tw("flex-row items-center justify-between rounded-lg p-3"),
                        { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-50"] },
                        pressed && { backgroundColor: isDark ? colors["gray-700"] : colors["gray-100"] }
                      ]}
                    >
                      <View style={tw("flex-1 pr-2")}>
                        <View style={tw("flex-row items-center gap-2")}>
                          <Text style={[tw("text-xs font-medium"), { color: colors.textTertiary }]}>
                            {task.identifier}
                          </Text>
                          {dueDateInfo && (
                            <View
                              style={[
                                tw("rounded px-1 py-0"),
                                {
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  backgroundColor:
                                    dueDateInfo.color === colors.danger
                                      ? (isDark ? colors["red-900"] : colors["red-100"])
                                      : dueDateInfo.color === colors.warning
                                        ? (isDark ? colors["orange-900"] : "#FFEDD5")
                                        : (isDark ? colors["gray-700"] : colors["gray-100"]),
                                }
                              ]}
                            >
                              <Text
                                style={[tw("text-xs font-medium"), { color: dueDateInfo.color }]}
                              >
                                {dueDateInfo.text}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[tw("mt-1 text-sm"), { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {task.title}
                        </Text>
                      </View>
                      <View
                        style={[
                          tw("h-3 w-3 rounded-full"),
                          { backgroundColor: task.project.color ?? "#6b7280" }
                        ]}
                      />
                    </Pressable>
                  );
                })}
                {filteredTasks.length > 5 && (
                  <Text style={[tw("mt-2 text-center text-sm"), { color: colors.textTertiary }]}>
                    +{filteredTasks.length - 5} more tasks
                  </Text>
                )}
              </View>
            )}
          </CardContent>
        </Card>

        {/* Recently Completed Card */}
        {dashboard?.recentlyCompleted &&
          dashboard.recentlyCompleted.length > 0 && (
            <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              <CardHeader>
                <CardTitle style={{ color: colors.text }}>Recently Completed</CardTitle>
                <CardDescription style={{ color: colors.textSecondary }}>Last 7 days</CardDescription>
              </CardHeader>
              <CardContent>
                <View style={tw("gap-2")}>
                  {dashboard.recentlyCompleted.slice(0, 3).map((task) => (
                    <Pressable
                      key={task.id}
                      onPress={() => handleTaskPress(task.id)}
                      style={({ pressed }) => [
                        tw("flex-row items-center justify-between rounded-lg p-3"),
                        { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-50"] },
                        pressed && { backgroundColor: isDark ? colors["gray-700"] : colors["gray-100"] }
                      ]}
                    >
                      <View style={tw("flex-1 pr-2")}>
                        <Text style={[tw("text-xs font-medium"), { color: colors.textTertiary }]}>
                          {task.identifier}
                        </Text>
                        <Text
                          style={[tw("mt-1 text-sm line-through"), { color: colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {task.title}
                        </Text>
                      </View>
                      <View style={[tw("h-5 w-5 items-center justify-center rounded-full"), { backgroundColor: isDark ? colors["green-900"] : colors["green-100"] }]}>
                        <Text style={[tw("text-xs"), { color: colors.success }]}>✓</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </CardContent>
            </Card>
          )}
      </ScrollView>
    </View>
  );
}
