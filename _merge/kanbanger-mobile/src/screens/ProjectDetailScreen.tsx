import { useCallback } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { trpc } from "../lib/trpc";
import { ProgressRing } from "../components/ProgressRing";
import { StatusDistributionBar } from "../components/StatusDistributionBar";
import { Card, CardContent, CardHeader, CardTitle, Badge, BadgeText } from "@linear-clone/ui-native";
import type { ProjectsStackParamList } from "../navigation/types";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

type ProjectDetailRouteProp = RouteProp<ProjectsStackParamList, "ProjectDetail">;
type ProjectDetailNavigationProp = NativeStackNavigationProp<ProjectsStackParamList, "ProjectDetail">;

const statusLabels: Record<string, string> = {
  backlog: "Backlog",
  planned: "Planned",
  in_progress: "In Progress",
  paused: "Paused",
  completed: "Completed",
  canceled: "Canceled",
};

const activityTypeLabels: Record<string, string> = {
  created: "created",
  updated: "updated",
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_changed: "reassigned",
  comment_added: "commented on",
  label_added: "added label to",
  label_removed: "removed label from",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString();
}

export function ProjectDetailScreen() {
  const route = useRoute<ProjectDetailRouteProp>();
  const navigation = useNavigation<ProjectDetailNavigationProp>();
  const { colors, isDark } = useTheme();
  const { projectId } = route.params;

  const {
    data: project,
    isLoading: projectLoading,
    refetch: refetchProject,
  } = trpc.project.get.useQuery({ id: projectId });

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = trpc.project.getStats.useQuery({ projectId });

  const isLoading = projectLoading || statsLoading;
  const isRefetching = false;

  const handleRefresh = useCallback(() => {
    refetchProject();
    refetchStats();
  }, [refetchProject, refetchStats]);

  const handleViewAllTasks = () => {
    navigation.getParent()?.navigate("Tasks", {
      screen: "TasksList",
      params: { projectId },
    });
  };

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      backlog: isDark ? colors["gray-700"] : colors["gray-500"],
      planned: isDark ? colors["gray-600"] : colors["gray-500"],
      in_progress: isDark ? colors["blue-600"] : colors["blue-500"],
      paused: isDark ? colors["yellow-600"] : colors["yellow-500"],
      completed: isDark ? colors["green-600"] : colors["green-500"],
      canceled: isDark ? colors["red-600"] : colors["red-500"],
    };
    return map[status] ?? colors["gray-500"];
  };

  if (isLoading) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[tw("mt-2"), { color: colors.textSecondary }]}>Loading project...</Text>
      </View>
    );
  }

  if (!project) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Project not found</Text>
      </View>
    );
  }

  const progress =
    project.issueCount > 0
      ? Math.round((project.completedCount / project.issueCount) * 100)
      : 0;

  const statusCounts = stats?.statusCounts ?? {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    canceled: 0,
  };

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]}>
      <View style={[tw("border-b px-4 py-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={tw("flex-row items-center")}>
          <Pressable onPress={() => navigation.goBack()} style={[tw("mr-3 p-1")]}>
            <Text style={[tw("text-2xl"), { color: colors.textSecondary }]}>←</Text>
          </Pressable>
          <View
            style={[
              tw("mr-3 h-10 w-10 items-center justify-center rounded-lg"),
              { backgroundColor: `${project.project.color ?? "#6366f1"}20` }
            ]}
          >
            <Text
              style={[tw("text-lg font-bold"), { color: project.project.color ?? "#6366f1" }]}
            >
              {project.project.name.charAt(0)}
            </Text>
          </View>
          <View style={tw("flex-1")}>
            <Text style={[tw("text-lg font-bold"), { color: colors.text }]}>
              {project.project.name}
            </Text>
            <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>{project.project.key}</Text>
          </View>
          <Badge style={{ backgroundColor: getStatusColor(project.project.status), paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 }}>
            <BadgeText style={{ fontSize: 12, color: colors.white }}>
              {statusLabels[project.project.status]}
            </BadgeText>
          </Badge>
        </View>
      </View>

      <ScrollView
        style={tw("flex-1")}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <View style={tw("flex-row gap-4")}>
          <Card style={{ flex: 1, backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardContent style={{ alignItems: "center", paddingVertical: 16 }}>
              <ProgressRing
                progress={progress}
                size="lg"
                color={project.project.color ?? colors.primary}
              />
              <Text style={[tw("mt-2 text-sm"), { color: colors.textSecondary }]}>Completion</Text>
            </CardContent>
          </Card>

          <View style={[tw("flex-1 gap-3")]}>
            <View style={tw("flex-row gap-3")}>
              <View style={[tw("flex-1 rounded-xl border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>Issues</Text>
                <Text style={[tw("text-xl font-bold"), { color: colors.text }]}>
                  {project.issueCount}
                </Text>
              </View>
              <View style={[tw("flex-1 rounded-xl border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>Done</Text>
                <Text style={[tw("text-xl font-bold"), { color: colors.success }]}>
                  {project.completedCount}
                </Text>
              </View>
            </View>
            <View style={tw("flex-row gap-3")}>
              <View style={[tw("flex-1 rounded-xl border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>Overdue</Text>
                <Text
                  style={[
                    tw("text-xl font-bold"),
                    { color: (stats?.overdueCount ?? 0) > 0 ? colors.danger : colors.text }
                  ]}
                >
                  {stats?.overdueCount ?? 0}
                </Text>
              </View>
              <View style={[tw("flex-1 rounded-xl border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>Blocked</Text>
                <Text
                  style={[
                    tw("text-xl font-bold"),
                    { color: (stats?.blockedCount ?? 0) > 0 ? colors.warning : colors.text }
                  ]}
                >
                  {stats?.blockedCount ?? 0}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <CardHeader>
            <CardTitle style={{ color: colors.text }}>Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusDistributionBar counts={statusCounts} showLegend showLabels />
          </CardContent>
        </Card>

        {stats?.activeCycle && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <View style={tw("flex-row items-center justify-between")}>
                <CardTitle style={{ color: colors.text }}>Active Sprint</CardTitle>
                <Badge style={{ backgroundColor: isDark ? colors["blue-900"] : colors["blue-100"], paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                  <BadgeText style={{ fontSize: 12, color: isDark ? colors["blue-300"] : colors["blue-700"] }}>Active</BadgeText>
                </Badge>
              </View>
            </CardHeader>
            <CardContent>
              <Text style={[tw("text-base font-semibold"), { color: colors.text }]}>
                {stats.activeCycle.name ?? `Cycle ${stats.activeCycle.number}`}
              </Text>
              <Text style={[tw("mt-1 text-sm"), { color: colors.textSecondary }]}>
                {stats.activeCycle.team?.name}
              </Text>

              <View style={tw("mt-3")}>
                <View style={tw("mb-1 flex-row justify-between")}>
                  <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>Progress</Text>
                  <Text style={[tw("text-xs font-medium"), { color: colors.text }]}>
                    {stats.activeCycle.completedCount}/{stats.activeCycle.issueCount}
                  </Text>
                </View>
                <View style={[tw("h-2 overflow-hidden rounded-full"), { backgroundColor: isDark ? colors["gray-700"] : colors["gray-200"] }]}>
                  <View
                    style={[
                      tw("h-full rounded-full"),
                      { width: `${stats.activeCycle.issueCount > 0 ? (stats.activeCycle.completedCount / stats.activeCycle.issueCount) * 100 : 0}%`, backgroundColor: colors.primary }
                    ]}
                  />
                </View>
              </View>

              {stats.activeCycle.endDate && (
                <Text style={[tw("mt-2 text-xs"), { color: colors.textSecondary }]}>
                  Ends {new Date(stats.activeCycle.endDate).toLocaleDateString()}
                </Text>
              )}
            </CardContent>
          </Card>
        )}

        {stats?.recentActivity && stats.recentActivity.length > 0 && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <CardTitle style={{ color: colors.text }}>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <View style={tw("gap-3")}>
                {stats.recentActivity.slice(0, 8).map((activity) => (
                  <View key={activity.id} style={tw("flex-row items-start gap-3")}>
                    <View style={[tw("h-8 w-8 items-center justify-center rounded-full"), { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"] }]}>
                      <Text style={[tw("text-xs font-medium"), { color: colors.textSecondary }]}>
                        {activity.user?.name?.charAt(0) ?? "?"}
                      </Text>
                    </View>
                    <View style={tw("flex-1")}>
                      <Text style={[tw("text-sm"), { color: colors.text }]}>
                        <Text style={tw("font-medium")}>{activity.user?.name ?? "Someone"}</Text>
                        {" "}
                        {activityTypeLabels[activity.type] ?? activity.type}
                        {" "}
                        <Text style={tw("font-medium")}>{activity.issue?.identifier}</Text>
                      </Text>
                      <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                        {formatRelativeTime(activity.createdAt)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </CardContent>
          </Card>
        )}

        {project.project.description && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <CardTitle style={{ color: colors.text }}>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <Text style={[tw("text-sm"), { color: colors.textSecondary }]}>
                {project.project.description}
              </Text>
            </CardContent>
          </Card>
        )}

        {project.teams && project.teams.length > 0 && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <CardHeader>
              <CardTitle style={{ color: colors.text }}>Teams</CardTitle>
            </CardHeader>
            <CardContent>
              <View style={tw("flex-row flex-wrap gap-2")}>
                {project.teams.map((team) => (
                  <View
                    key={team.id}
                    style={[tw("flex-row items-center rounded-full px-3"), { paddingVertical: 6, backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-100"] }]}
                  >
                    <View
                      style={[tw("mr-2 h-2 w-2 rounded-full"), { backgroundColor: team.color ?? "#6366f1" }]}
                    />
                    <Text style={[tw("text-sm"), { color: colors.text }]}>{team.name}</Text>
                  </View>
                ))}
              </View>
            </CardContent>
          </Card>
        )}

        <Pressable
          onPress={handleViewAllTasks}
          style={({ pressed }) => [
            tw("rounded-xl px-4 py-3"),
            { backgroundColor: colors.primary },
            pressed && { opacity: 0.8 }
          ]}
        >
          <Text style={[tw("text-center text-base font-semibold"), { color: colors.primaryForeground }]}>
            View All Tasks
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
