import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
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
import { AgentStatusIndicator } from "../components/AgentStatusIndicator";
import type { TasksStackParamList } from "../navigation/types";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

type AgentActivityNavigationProp = NativeStackNavigationProp<TasksStackParamList>;

type AgentTaskRunStatus = "claimed" | "in_progress" | "completed" | "failed" | "abandoned" | "handed_off";

const statusLabels: Record<AgentTaskRunStatus, string> = {
  claimed: "Claimed",
  in_progress: "Working",
  completed: "Completed",
  failed: "Failed",
  abandoned: "Abandoned",
  handed_off: "Handed Off",
};

export function AgentActivityScreen() {
  const navigation = useNavigation<AgentActivityNavigationProp>();
  const { workspaceId } = useWorkspace();
  const { colors, isDark } = useTheme();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const {
    data: stats,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.agent.getWorkspaceAgentStats.useQuery(
    { workspaceId },
    { enabled: !!workspaceId }
  );

  const {
    data: agentActivity,
    isLoading: isLoadingActivity,
  } = trpc.agent.getAgentActivity.useQuery(
    { agentId: selectedAgentId!, limit: 20 },
    { enabled: !!selectedAgentId }
  );

  const getStatusColor = (status: AgentTaskRunStatus) => {
    const map: Record<AgentTaskRunStatus, { bg: string; text: string }> = {
      claimed: { bg: isDark ? colors["blue-900"] : colors["blue-100"], text: isDark ? colors["blue-300"] : colors["blue-700"] },
      in_progress: { bg: isDark ? colors["yellow-900"] : "#FEF9C3", text: isDark ? colors["yellow-300"] : "#A16207" },
      completed: { bg: isDark ? colors["green-900"] : colors["green-100"], text: isDark ? colors["green-300"] : colors["green-600"] },
      failed: { bg: isDark ? colors["red-900"] : colors["red-100"], text: isDark ? colors["red-300"] : colors["red-600"] },
      abandoned: { bg: isDark ? colors["gray-700"] : colors["gray-100"], text: isDark ? colors["gray-300"] : colors["gray-700"] },
      handed_off: { bg: isDark ? colors["purple-900"] : "#F3E8FF", text: isDark ? colors["purple-300"] : colors["purple-600"] },
    };
    return map[status];
  };

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[tw("mt-2"), { color: colors.textSecondary }]}>Loading agents...</Text>
      </View>
    );
  }

  const agents = stats?.agents ?? [];
  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.id === selectedAgentId)
    : null;

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]} testID="agents-screen">
      <View style={[tw("px-4 pt-4 pb-2 border-b"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text testID="agents-header" style={[tw("text-2xl font-bold"), { color: colors.text }]}>AI Agents</Text>
        <Text style={[tw("text-sm"), { color: colors.textSecondary }]}>
          {stats?.activeNow ?? 0} active, {stats?.totalCompleted ?? 0} tasks completed
        </Text>
      </View>

      <View style={tw("flex-row gap-3 p-4")}>
        <View style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>Active</Text>
          <Text style={[tw("mt-1 text-2xl font-bold"), { color: colors.success }]}>
            {stats?.activeNow ?? 0}
          </Text>
        </View>
        <View style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>Completed</Text>
          <Text style={[tw("mt-1 text-2xl font-bold"), { color: colors.primary }]}>
            {stats?.totalCompleted ?? 0}
          </Text>
        </View>
        <View style={[tw("flex-1 rounded-xl border p-4 shadow-sm"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[tw("text-xs font-medium uppercase"), { color: colors.textSecondary }]}>Failed</Text>
          <Text style={[tw("mt-1 text-2xl font-bold"), { color: colors.danger }]}>
            {stats?.totalFailed ?? 0}
          </Text>
        </View>
      </View>

      {agents.length === 0 ? (
        <View style={tw("flex-1 items-center justify-center px-4")}>
          <Text style={[tw("text-lg text-center"), { color: colors.textTertiary }]}>
            No AI agents configured
          </Text>
          <Text style={[tw("text-sm mt-2 text-center"), { color: colors.textTertiary }]}>
            Create an agent in settings to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />
          }
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item: agent }) => (
            <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              <Pressable
                onPress={() =>
                  setSelectedAgentId(
                    selectedAgentId === agent.id ? null : agent.id
                  )
                }
                style={({ pressed }) => pressed && { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-50"] }}
              >
                <CardHeader style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={tw("flex-row items-center flex-1")}>
                    <AgentStatusIndicator
                      name={agent.name}
                      status={agent.isActive ? "working" : "idle"}
                      showStatus={false}
                      size="md"
                    />
                    <View style={tw("ml-3 flex-1")}>
                      <CardTitle style={{ fontSize: 16, color: colors.text }}>{agent.name ?? "Unnamed Agent"}</CardTitle>
                      <CardDescription style={{ color: colors.textSecondary }}>
                        {agent.isActive ? (
                          <Text style={{ color: colors.success }}>Working</Text>
                        ) : (
                          <Text style={{ color: colors.textTertiary }}>Idle</Text>
                        )}
                        {" - "}
                        {agent.completed} completed, {agent.failed} failed
                      </CardDescription>
                    </View>
                  </View>
                  <Text style={{ color: colors.textTertiary }}>
                    {selectedAgentId === agent.id ? "▼" : "▶"}
                  </Text>
                </CardHeader>
              </Pressable>

              {selectedAgentId === agent.id && (
                <CardContent>
                  {isLoadingActivity ? (
                    <View style={tw("py-4 items-center")}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  ) : agentActivity && agentActivity.length > 0 ? (
                    <View style={tw("gap-2")}>
                      <Text style={[tw("text-sm font-medium mb-2"), { color: colors.text }]}>
                        Recent Activity
                      </Text>
                      {agentActivity.map((run) => (
                        <Pressable
                          key={run.id}
                          onPress={() => {
                            navigation.navigate("TaskDetail", {
                              taskId: run.issueId,
                            });
                          }}
                          style={({ pressed }) => [
                            tw("rounded-lg p-3"),
                            { backgroundColor: isDark ? colors.surfaceHighlight : colors["gray-50"] },
                            pressed && { backgroundColor: isDark ? colors["gray-700"] : colors["gray-100"] }
                          ]}
                        >
                          <View style={tw("flex-row items-center justify-between")}>
                            <View
                              style={[
                                tw("px-2 rounded"),
                                { 
                                  paddingVertical: 2,
                                  backgroundColor: getStatusColor(run.status as AgentTaskRunStatus)?.bg
                                }
                              ]}
                            >
                              <Text
                                style={[
                                  tw("text-xs font-medium"),
                                  { color: getStatusColor(run.status as AgentTaskRunStatus)?.text }
                                ]}
                              >
                                {statusLabels[run.status as AgentTaskRunStatus] ?? run.status}
                              </Text>
                            </View>
                            <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                              {formatDate(run.claimedAt)}
                            </Text>
                          </View>
                          {run.result && (
                            <Text
                              style={[tw("text-sm mt-2"), { color: colors.textSecondary }]}
                              numberOfLines={2}
                            >
                              {typeof run.result === 'object' && 'summary' in run.result
                                ? (run.result as { summary?: string }).summary
                                : run.result && typeof run.result === 'object' && 'error' in run.result
                                  ? (run.result as { error?: { message?: string } }).error?.message
                                  : null}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <View style={tw("py-4 items-center")}>
                      <Text style={{ color: colors.textTertiary }}>No activity yet</Text>
                    </View>
                  )}
                </CardContent>
              )}
            </Card>
          )}
        />
      )}
    </View>
  );
}
