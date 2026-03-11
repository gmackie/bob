import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Animated,
  Easing,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { trpc } from "../lib/trpc";
import { useWorkspace } from "../lib/workspace-context";
import {
  Avatar,
  AvatarFallback,
  AvatarFallbackText,
  AvatarImage,
  Badge,
  BadgeText,
  Button,
  ButtonText,
} from "@linear-clone/ui-native";
import type { TaskDetailScreenProps } from "../navigation/types";
import type { TaskStatus, TaskPriority } from "../components/TaskRow";
import { AssigneePicker } from "../components/AssigneePicker";
import { LabelsPicker } from "../components/LabelsPicker";
import { DueDatePicker } from "../components/DueDatePicker";
import { CommentsList } from "../components/CommentsList";
import { CommentComposer } from "../components/CommentComposer";
import { HeaderMenu } from "../components/HeaderMenu";
import { lightHaptic } from "../lib/haptics";
import { AgentBadge } from "../components/AgentStatusIndicator";
import { tw } from "../lib/styles";
import { useTheme } from "../lib/theme";

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "canceled", label: "Canceled" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "no_priority", label: "No priority" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

type DocRequestType = "brd" | "detailed_requirements" | "design_docs" | "tasks" | "team_paradigms";

const docRequestOptions: { type: DocRequestType; label: string; template: string }[] = [
  {
    type: "brd",
    label: "Request BRD",
    template: "Please generate/update the BRD for this initiative and include assumptions, risks, and acceptance criteria.",
  },
  {
    type: "detailed_requirements",
    label: "Request Detailed Requirements",
    template: "Please draft/update detailed requirements for this initiative, including edge cases and functional details.",
  },
  {
    type: "design_docs",
    label: "Request Design Docs",
    template: "Please create/update design docs for architecture and implementation approach for this initiative.",
  },
  {
    type: "tasks",
    label: "Request Task Breakdown",
    template: "Please break this initiative into implementation tasks with clear ownership and dependencies.",
  },
  {
    type: "team_paradigms",
    label: "Request Team Paradigms",
    template: "Please align this initiative with team paradigms and working agreements before execution.",
  },
];

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
  ready_for_execution: "Ready for Execution",
  picked_up: "Picked Up",
  staging_deployed: "Staging Deployed",
  staging_verified: "Staging Verified",
  production_deployed: "Production Deployed",
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

interface TaskDetailScreenComponentProps {
  taskId?: string;
  onBack?: () => void;
}

export function TaskDetailScreen({ taskId: propTaskId, onBack }: TaskDetailScreenComponentProps = {}) {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const route = useRoute<TaskDetailScreenProps["route"]>();
  const routeTaskId = route.params?.taskId;
  const taskId = propTaskId ?? routeTaskId;
  
  const { workspaceId } = useWorkspace();
  const utils = trpc.useUtils();

  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showLabelsPicker, setShowLabelsPicker] = useState(false);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isRequestingDoc, setIsRequestingDoc] = useState<DocRequestType | null>(null);

  const { data: task, isLoading, refetch, isRefetching } = trpc.issue.get.useQuery(
    { id: taskId! },
    { enabled: !!taskId }
  );

  const updateMutation = trpc.issue.update.useMutation({
    onSuccess: () => {
      lightHaptic();
      utils.issue.get.invalidate({ id: taskId! });
      utils.issue.list.invalidate();
      utils.issue.dashboard.invalidate();
    },
  });

  const setLabelsMutation = trpc.issue.setLabels.useMutation({
    onSuccess: () => {
      lightHaptic();
      utils.issue.get.invalidate({ id: taskId! });
      utils.issue.list.invalidate();
    },
  });

  const requestDocMutation = trpc.comment.create.useMutation({
    onSuccess: () => {
      if (taskId) {
        utils.comment.list.invalidate({ issueId: taskId });
        utils.issue.get.invalidate({ id: taskId });
      }
    },
  });

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigation.goBack();
    }
  };

  if (!taskId) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Select a task to view details</Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={[tw("flex-1 items-center justify-center"), { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Task not found</Text>
        <Button onPress={handleBack} style={{ marginTop: 16 }}>
          <ButtonText>Go back</ButtonText>
        </Button>
      </View>
    );
  }

  const handleStatusChange = (status: TaskStatus) => {
    updateMutation.mutate({ id: taskId, status });
    setShowStatusPicker(false);
  };

  const handlePriorityChange = (priority: TaskPriority) => {
    updateMutation.mutate({ id: taskId, priority });
    setShowPriorityPicker(false);
  };

  const handleAssigneeChange = (assigneeId: string | null) => {
    updateMutation.mutate({ id: taskId, assigneeId });
  };

  const handleLabelsChange = (labelIds: string[]) => {
    setLabelsMutation.mutate({ issueId: taskId, labelIds });
  };

  const handleDueDateChange = (dueDate: Date | null) => {
    updateMutation.mutate({ id: taskId, dueDate });
  };

  const handleDescriptionSave = () => {
    updateMutation.mutate({ id: taskId, description: descriptionDraft || null });
    setEditingDescription(false);
  };

  const handleRequestDoc = async (docType: DocRequestType) => {
    if (!taskId || !task) return;
    const option = docRequestOptions.find((entry) => entry.type === docType);
    if (!option) return;
    const body =
      `${option.template}\n\n` +
      `Context:\n` +
      `- Issue: ${task.identifier}\n` +
      `- Title: ${task.title}\n` +
      `- Artifact: ${(task as { funnelArtifactType?: string | null }).funnelArtifactType ?? "Unknown"}\n` +
      `- Stage: ${(task as { funnelStage?: string | null }).funnelStage ?? "Unstaged"}`;
    setIsRequestingDoc(docType);
    try {
      await requestDocMutation.mutateAsync({
        issueId: taskId,
        body,
      });
    } finally {
      setIsRequestingDoc(null);
    }
  };

  const startEditingDescription = () => {
    setDescriptionDraft(task.description ?? "");
    setEditingDescription(true);
  };

  const currentArtifactLabel =
    formatFunnelArtifact((task as { funnelArtifactType?: string | null } | null | undefined)?.funnelArtifactType) ??
    "Unknown";
  const currentStageLabel =
    formatFunnelStage((task as { funnelStage?: string | null } | null | undefined)?.funnelStage) ?? "Unstaged";
  const currentStage = (task as { funnelStage?: string | null } | null | undefined)?.funnelStage;
  const normalizedStage = funnelStageOrder.find((stage) => stage === currentStage);
  const stageIndex = normalizedStage ? funnelStageOrder.indexOf(normalizedStage) : -1;
  const progressAnim = useRef(
    new Animated.Value(stageIndex >= 0 ? (stageIndex + 1) / funnelStageOrder.length : 0)
  ).current;

  useEffect(() => {
    const target = stageIndex >= 0 ? (stageIndex + 1) / funnelStageOrder.length : 0;
    Animated.timing(progressAnim, {
      toValue: target,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progressAnim, stageIndex]);

  const formatDate = (date: Date | null | undefined) => {
    if (!date) return null;
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getDueDateColor = (date: Date | null | undefined) => {
    if (!date) return colors.text;
    const now = new Date();
    const due = new Date(date);
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return colors.danger;
    if (diffDays <= 1) return colors.warning;
    return colors.text;
  };

  return (
    <View style={[tw("flex-1"), { backgroundColor: colors.background }]}>
      <View style={[tw("flex-row items-center justify-between border-b px-4 py-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Pressable onPress={handleBack} style={[tw("p-2"), { marginLeft: -8 }]}>
          <Text style={[tw("font-medium"), { color: colors.primary }]}>← Back</Text>
        </Pressable>
        <Text style={[tw("font-mono text-sm"), { color: colors.textSecondary }]}>{task.identifier}</Text>
        <HeaderMenu
          taskIdentifier={task.identifier}
          taskTitle={task.title}
          taskId={taskId}
        />
      </View>

      <ScrollView
        style={tw("flex-1")}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        <View style={tw("p-4")}>
          <Text style={[tw("text-xl font-bold mb-4"), { color: colors.text }]}>{task.title}</Text>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Funnel context</Text>
            <View style={tw("flex-row flex-wrap gap-2")}>
              <Badge
                style={{ backgroundColor: isDark ? "#312e81" : "#e0e7ff", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 }}
              >
                <BadgeText style={{ color: isDark ? colors["indigo-300"] : "#3730a3", fontSize: 12 }}>
                  Artifact: {currentArtifactLabel}
                </BadgeText>
              </Badge>
              <Badge
                style={{ backgroundColor: isDark ? "#0f172a" : "#e2e8f0", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 }}
              >
                <BadgeText style={{ color: isDark ? colors["gray-200"] : colors["gray-600"], fontSize: 12 }}>
                  Stage: {currentStageLabel}
                </BadgeText>
              </Badge>
            </View>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Funnel progress</Text>
            <View style={[tw("rounded-xl border p-3"), { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={tw("flex-row justify-between mb-2")}>
                <Text style={[tw("text-xs"), { color: colors.textSecondary }]}>
                  {stageIndex >= 0 ? `Stage ${stageIndex + 1} of ${funnelStageOrder.length}` : "Unstaged"}
                </Text>
                <Text style={[tw("text-xs font-medium"), { color: colors.text }]}>
                  {currentStageLabel}
                </Text>
              </View>

              <View
                style={[
                  tw("h-2 rounded-full overflow-hidden"),
                  { backgroundColor: isDark ? "#1f2937" : "#e5e7eb" },
                ]}
              >
                <Animated.View
                  style={{
                    height: "100%",
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                    backgroundColor: isDark ? "#10b981" : "#059669",
                  }}
                />
              </View>

              <View style={tw("flex-row gap-1 mt-2")}>
                {funnelStageOrder.map((stage, idx) => {
                  const isCurrent = idx === stageIndex && idx >= 0;
                  const isComplete = stageIndex >= 0 && idx < stageIndex;
                  return (
                    <View
                      key={stage}
                      style={{
                        flex: 1,
                        height: 8,
                        borderRadius: 9999,
                        backgroundColor: isCurrent
                          ? (isDark ? "#312e81" : "#3b82f6")
                          : isComplete
                            ? (isDark ? "#059669" : "#10b981")
                            : (isDark ? "#374151" : "#d1d5db"),
                      }}
                    />
                  );
                })}
              </View>

              <View style={tw("flex-row justify-between mt-2")}>
                <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                  {formatFunnelStage(funnelStageOrder[0])}
                </Text>
                <Text style={[tw("text-xs"), { color: colors.textTertiary }]}>
                  {formatFunnelStage(funnelStageOrder[funnelStageOrder.length - 1])}
                </Text>
              </View>
            </View>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Request additional docs</Text>
            <View style={tw("flex-row flex-wrap gap-2")}>
              {docRequestOptions.map((option) => {
                const isLoading = isRequestingDoc === option.type || requestDocMutation.isPending;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => handleRequestDoc(option.type)}
                    disabled={isLoading}
                    style={({ pressed }) => [
                      tw("rounded-full border px-3 py-2"),
                      {
                        borderColor: isLoading ? colors.border : colors.textSecondary,
                        backgroundColor: isDark ? colors.surface : colors.surface,
                        opacity: pressed ? 0.88 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        tw("text-sm"),
                        { color: isLoading ? colors.textTertiary : colors.text, opacity: isLoading ? 0.7 : 1 },
                      ]}
                    >
                      {isLoading ? "Sending..." : option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Status</Text>
            <Pressable
              onPress={() => setShowStatusPicker(!showStatusPicker)}
              style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>
                {statusOptions.find((s) => s.value === task.status)?.label}
              </Text>
            </Pressable>
            {showStatusPicker && (
              <View style={[tw("rounded-lg border mt-2"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {statusOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => handleStatusChange(option.value)}
                    style={[
                      tw("p-3 border-b"),
                      { borderColor: isDark ? colors["gray-800"] : colors["gray-100"] },
                      task.status === option.value && { backgroundColor: isDark ? colors["indigo-900"] : colors["indigo-100"] }
                    ]}
                  >
                    <Text
                      style={
                        task.status === option.value
                          ? [tw("font-medium"), { color: colors.primary }]
                          : { color: colors.text }
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Priority</Text>
            <Pressable
              onPress={() => setShowPriorityPicker(!showPriorityPicker)}
              style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={{ color: colors.text }}>
                {priorityOptions.find((p) => p.value === task.priority)?.label}
              </Text>
            </Pressable>
            {showPriorityPicker && (
              <View style={[tw("rounded-lg border mt-2"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {priorityOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => handlePriorityChange(option.value)}
                    style={[
                      tw("p-3 border-b"),
                      { borderColor: isDark ? colors["gray-800"] : colors["gray-100"] },
                      task.priority === option.value && { backgroundColor: isDark ? colors["indigo-900"] : colors["indigo-100"] }
                    ]}
                  >
                    <Text
                      style={
                        task.priority === option.value
                          ? [tw("font-medium"), { color: colors.primary }]
                          : { color: colors.text }
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Assignee</Text>
            <Pressable
              onPress={() => setShowAssigneePicker(true)}
              style={[tw("rounded-lg border p-3 flex-row items-center"), { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {task.assignee ? (
                <>
                  <Avatar style={{ height: 32, width: 32, marginRight: 12 }}>
                    {task.assignee.avatarUrl ? (
                      <AvatarImage src={task.assignee.avatarUrl} />
                    ) : null}
                    <AvatarFallback style={{ backgroundColor: isDark ? colors["indigo-900"] : colors["indigo-100"] }}>
                      <AvatarFallbackText style={{ fontSize: 12, color: isDark ? colors["indigo-300"] : colors["indigo-600"] }}>
                        {task.assignee.name?.charAt(0) ?? "?"}
                      </AvatarFallbackText>
                    </AvatarFallback>
                  </Avatar>
                  <Text style={[tw("flex-1"), { color: colors.text }]}>{task.assignee.name}</Text>
                  <Text style={[tw("text-sm"), { color: colors.textSecondary }]}>Change</Text>
                </>
              ) : (
                <>
                  <Text style={[tw("flex-1"), { color: colors.textSecondary }]}>Unassigned</Text>
                  <Text style={[tw("text-sm"), { color: colors.primary }]}>Assign</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Labels</Text>
            <Pressable
              onPress={() => setShowLabelsPicker(true)}
              style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {task.labels && task.labels.length > 0 ? (
                <View style={tw("flex-row flex-wrap gap-2")}>
                  {task.labels.map((label) => (
                    <Badge
                      key={label.id}
                      style={{ backgroundColor: `${label.color}20`, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 9999 }}
                    >
                      <BadgeText style={{ color: label.color, fontSize: 14 }}>
                        {label.name}
                      </BadgeText>
                    </Badge>
                  ))}
                  <Text style={[tw("text-sm self-center"), { marginLeft: 4, color: colors.primary }]}>Edit</Text>
                </View>
              ) : (
                <View style={tw("flex-row justify-between items-center")}>
                  <Text style={{ color: colors.textSecondary }}>No labels</Text>
                  <Text style={[tw("text-sm"), { color: colors.primary }]}>Add</Text>
                </View>
              )}
            </Pressable>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Due Date</Text>
            <Pressable
              onPress={() => setShowDueDatePicker(true)}
              style={[tw("rounded-lg border p-3 flex-row justify-between items-center"), { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {task.dueDate ? (
                <>
                  <Text style={{ color: getDueDateColor(task.dueDate) }}>
                    {formatDate(task.dueDate)}
                  </Text>
                  <Text style={[tw("text-sm"), { color: colors.textSecondary }]}>Change</Text>
                </>
              ) : (
                <>
                  <Text style={{ color: colors.textSecondary }}>No due date</Text>
                  <Text style={[tw("text-sm"), { color: colors.primary }]}>Set</Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Description</Text>
            {editingDescription ? (
              <View>
                <TextInput
                  value={descriptionDraft}
                  onChangeText={setDescriptionDraft}
                  multiline
                  numberOfLines={6}
                  style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text, minHeight: 120, textAlignVertical: "top" }]}
                  placeholder="Add a description..."
                  placeholderTextColor={colors.textTertiary}
                />
                <View style={tw("flex-row gap-2 mt-2")}>
                  <Button onPress={handleDescriptionSave} style={{ flex: 1, backgroundColor: colors.primary }}>
                    <ButtonText style={{ color: colors.primaryForeground }}>Save</ButtonText>
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => setEditingDescription(false)}
                    style={{ flex: 1, borderColor: colors.border }}
                  >
                    <ButtonText style={{ color: colors.text }}>Cancel</ButtonText>
                  </Button>
                </View>
              </View>
            ) : (
              <Pressable
                onPress={startEditingDescription}
                style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border, minHeight: 80 }]}
              >
                <Text style={{ color: task.description ? colors.text : colors.textSecondary }}>
                  {task.description || "Tap to add description..."}
                </Text>
              </Pressable>
            )}
          </View>

          {task.subIssuesCount > 0 && (
            <View style={tw("mb-4")}>
              <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Sub-tasks</Text>
              <View style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.text }}>{task.subIssuesCount} sub-task(s)</Text>
              </View>
            </View>
          )}

          <View style={tw("mb-4")}>
            <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Comments</Text>
            <View style={[tw("rounded-lg border p-3"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <CommentsList issueId={taskId} />
            </View>
          </View>

          {task.activities && task.activities.length > 0 && (
            <View style={tw("mb-4")}>
              <Text style={[tw("text-sm mb-2"), { color: colors.textSecondary }]}>Recent Activity</Text>
              <View style={[tw("rounded-lg border"), { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {task.activities.slice(0, 5).map((activity, index) => {
                  const isAgentActivity = activity.type.startsWith("agent_");
                  const activityLabel = activity.type
                    .replace("agent_", "")
                    .replace(/_/g, " ");
                  
                  let agentMetadataText: string | null = null;
                  if (isAgentActivity && activity.metadata) {
                    const meta = activity.metadata as Record<string, unknown>;
                    if ("progress" in meta) {
                      agentMetadataText = String(meta.progress);
                    } else if ("error" in meta && typeof meta.error === "object" && meta.error) {
                      agentMetadataText = String((meta.error as { message?: string }).message ?? "");
                    }
                  }
                  
                  return (
                    <View
                      key={activity.id}
                      style={[
                        tw("p-3"),
                        index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                        isAgentActivity && { backgroundColor: isDark ? colors["purple-900"] : "#FAF5FF" }
                      ]}
                    >
                      <View style={tw("flex-row items-center gap-2")}>
                        {isAgentActivity && (
                          <AgentBadge
                            isAgent={true}
                            isWorking={activity.type === "agent_started" || activity.type === "agent_progress"}
                          />
                        )}
                        <Text style={[tw("text-sm flex-1"), { color: colors.textSecondary }]}>
                          {activity.user?.name ?? "Someone"} {activityLabel}
                        </Text>
                      </View>
                      {agentMetadataText && (
                        <Text style={[tw("text-xs mt-1"), { color: colors["purple-600"] }]} numberOfLines={2}>
                          {agentMetadataText}
                        </Text>
                      )}
                      <Text style={[tw("text-xs mt-1"), { color: colors.textTertiary }]}>
                        {formatDate(activity.createdAt)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <CommentComposer issueId={taskId} />

      <AssigneePicker
        visible={showAssigneePicker}
        currentAssigneeId={task.assignee?.id ?? null}
        onSelect={handleAssigneeChange}
        onClose={() => setShowAssigneePicker(false)}
      />

      <LabelsPicker
        visible={showLabelsPicker}
        selectedLabelIds={task.labels?.map((l) => l.id) ?? []}
        onSelect={handleLabelsChange}
        onClose={() => setShowLabelsPicker(false)}
      />

      <DueDatePicker
        visible={showDueDatePicker}
        currentDate={task.dueDate ? new Date(task.dueDate) : null}
        onSelect={handleDueDateChange}
        onClose={() => setShowDueDatePicker(false)}
      />
    </View>
  );
}
