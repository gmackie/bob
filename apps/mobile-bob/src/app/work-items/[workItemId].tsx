import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { getWorkItemDetailPresentation } from "~/features/planning/work-item-detail";
import { getTaskWorkspaceHref } from "~/features/planning/navigation";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { getBaseUrl } from "~/utils/base-url";
import { colors } from "~/lib/colors";

const PIPELINE_STAGES = [
  { key: "idea", label: "Idea" },
  { key: "shape", label: "Shape" },
  { key: "plan", label: "Plan" },
  { key: "execute", label: "Execute" },
  { key: "review", label: "Review" },
  { key: "deploy", label: "Deploy" },
  { key: "live", label: "Live" },
] as const;

function detectMobileStage(input: {
  childCount: number;
  artifactCount: number;
  childStatuses: string[];
}): { stage: string; stageIndex: number } {
  const dispatched = input.childStatuses.filter(
    (s) => s === "in_progress" || s === "done" || s === "in_review",
  ).length;
  const completed = input.childStatuses.filter((s) => s === "done").length;

  if (completed === input.childCount && input.childCount > 0 && dispatched === input.childCount) {
    return { stage: "review", stageIndex: 4 };
  }
  if (dispatched > 0) return { stage: "execute", stageIndex: 3 };
  if (input.childCount > 0) return { stage: "plan", stageIndex: 2 };
  if (input.artifactCount > 0) return { stage: "shape", stageIndex: 1 };
  return { stage: "idea", stageIndex: 0 };
}

export default function WorkItemDetailScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ workItemId: string }>();
  const workItemId =
    typeof params.workItemId === "string" ? params.workItemId : "";
  const queryClient = useQueryClient();
  const [commentDraft, setCommentDraft] = useState("");

  const workItemQuery = useQuery(
    trpc.workItem.get.queryOptions(
      { id: workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const commentsQuery = useQuery(
    trpc.comment.listByWorkItem.queryOptions(
      { workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const createCommentMutation = useMutation(
    trpc.comment.create.mutationOptions({
      onSuccess: async () => {
        setCommentDraft("");
        await queryClient.invalidateQueries({
          queryKey: trpc.comment.listByWorkItem.queryKey({ workItemId }),
        });
      },
    }),
  );

  const promoteToTaskMutation = useMutation(
    trpc.workItem.promoteToTask.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.get.queryKey({ id: workItemId }),
        });
      },
    }),
  );

  const [dispatching, setDispatching] = useState(false);

  // Fetch child work items for epic/issue pipeline view
  const childItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      { workspaceId: workItemQuery.data?.workItem?.workspaceId ?? "", parentId: workItemId, limit: 50 },
      { enabled: Boolean(session && workItemId && workItemQuery.data?.workItem?.kind !== "task") },
    ),
  );

  const pipelineDetection = useMemo(() => {
    if (!workItemQuery.data || workItemQuery.data.workItem.kind === "task") return null;
    const children = childItemsQuery.data ?? [];
    return detectMobileStage({
      childCount: children.length,
      artifactCount: workItemQuery.data.currentArtifacts.length,
      childStatuses: children.map((c: any) => c.status),
    });
  }, [workItemQuery.data, childItemsQuery.data]);

  if (isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!session) {
    return <Redirect href="/" />;
  }

  if (workItemQuery.isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!workItemQuery.data) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
            Work item not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const { workItem, currentArtifacts, childCount } = workItemQuery.data;
  const detailPresentation = getWorkItemDetailPresentation({
    id: workItem.id,
    kind: workItem.kind,
  });

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5">
          <Text className="text-sm uppercase tracking-[0.18em]" style={{ color: colors.muted }}>
            {workItem.identifier}
          </Text>
          <Text className="mt-1 text-3xl font-semibold tracking-tight" style={{ color: colors.foreground }}>
            {workItem.title}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge variant="accent">{workItem.kind}</Badge>
            <Badge>{workItem.status.replace(/_/g, " ")}</Badge>
            {workItem.project ? (
              <Badge variant="success">{workItem.project.key}</Badge>
            ) : null}
          </View>
        </View>

        {/* Pipeline stepper for epics/issues */}
        {pipelineDetection ? (
          <Card variant="elevated" className="mb-5">
            <View className="flex-row justify-between">
              {PIPELINE_STAGES.map((stage, idx) => {
                const isCompleted = idx < pipelineDetection.stageIndex;
                const isCurrent = idx === pipelineDetection.stageIndex;
                return (
                  <View key={stage.key} className="items-center flex-1">
                    <View
                      className={`h-3 w-3 rounded-full ${
                        isCompleted
                          ? "bg-primary"
                          : isCurrent
                            ? "bg-primary/60"
                            : "bg-border"
                      }`}
                    />
                    <Text
                      className={`mt-1 text-[10px] ${
                        isCompleted || isCurrent ? "font-semibold" : ""
                      }`}
                      style={{ color: isCompleted || isCurrent ? colors.primary : colors.muted }}
                    >
                      {stage.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>
        ) : null}

        {workItem.description ? (
          <Card className="mb-5">
            <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
              Description
            </Text>
            <Text className="mt-3 text-sm leading-6" style={{ color: colors.muted }}>
              {workItem.description}
            </Text>
          </Card>
        ) : null}

        {/* Child tasks (for epics/issues) */}
        {childItemsQuery.data && childItemsQuery.data.length > 0 ? (
          <View className="mb-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
                Tasks ({childItemsQuery.data.filter((c: any) => c.status === "done").length}/{childItemsQuery.data.length})
              </Text>
              {pipelineDetection?.stage === "plan" ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={dispatching}
                  onPress={async () => {
                    setDispatching(true);
                    const tasks = (childItemsQuery.data ?? []).filter(
                      (c: any) => c.status === "todo" || c.status === "draft",
                    );
                    const baseUrl = getBaseUrl();
                    for (const task of tasks) {
                      try {
                        await fetch(`${baseUrl}/api/trpc/taskRun.execute`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ "0": { json: { workItemId: (task as any).id, agentType: "claude" } } }),
                        });
                      } catch {}
                    }
                    setDispatching(false);
                    await queryClient.invalidateQueries({
                      queryKey: trpc.workItem.list.queryKey({
                        workspaceId: workItem.workspaceId ?? "",
                        parentId: workItemId,
                        limit: 50,
                      }),
                    });
                  }}
                >
                  {dispatching ? "Dispatching..." : "Dispatch agents"}
                </Button>
              ) : null}
            </View>
            <Card>
              {childItemsQuery.data.map((child: any, index: number) => (
                <ListRow
                  key={child.id}
                  title={`${child.identifier ?? ""} ${child.title}`}
                  subtitle={child.status.replace(/_/g, " ")}
                  right={
                    <Badge
                      variant={
                        child.status === "done"
                          ? "success"
                          : child.status === "in_progress"
                            ? "accent"
                            : "default"
                      }
                    >
                      {child.status === "done" ? "Done" : child.status === "in_progress" ? "Running" : "Todo"}
                    </Badge>
                  }
                  onPress={() =>
                    router.push(
                      (child.kind === "task"
                        ? getTaskWorkspaceHref(child.id)
                        : `/work-items/${child.id}`) as never,
                    )
                  }
                  showDivider={index < childItemsQuery.data.length - 1}
                />
              ))}
            </Card>
          </View>
        ) : null}

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
            Planning context
          </Text>
          <Text className="mt-3 text-sm" style={{ color: colors.muted }}>
            {childCount} child items · {currentArtifacts.length} current artifacts
          </Text>
          <Text className="mt-4 text-sm font-semibold" style={{ color: colors.foreground }}>
            {detailPresentation.semanticSummary}
          </Text>
          <Text className="mt-2 text-sm leading-6" style={{ color: colors.muted }}>
            {detailPresentation.semanticHint}
          </Text>
          <Button
            className="mt-4"
            variant={workItem.kind === "task" ? "primary" : "secondary"}
            onPress={() => {
              if (workItem.kind === "task") {
                router.push(detailPresentation.executionHref as never);
                return;
              }

              promoteToTaskMutation.mutate({ id: workItem.id });
            }}
            disabled={promoteToTaskMutation.isPending}
          >
            {promoteToTaskMutation.isPending && workItem.kind !== "task"
              ? "Promoting..."
              : detailPresentation.primaryActionLabel}
          </Button>
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Artifacts</Text>
        </View>
        <Card className="mb-5">
          {currentArtifacts.length > 0 ? (
            currentArtifacts.map((artifact, index) => (
              <ListRow
                key={artifact.id}
                title={artifact.title ?? artifact.artifactRole}
                subtitle={artifact.url ?? undefined}
                showDivider={index < currentArtifacts.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>No artifacts attached yet.</Text>
          )}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Comments</Text>
        </View>
        <Card className="mb-4">
          {commentsQuery.data?.length ? (
            commentsQuery.data.map((comment, index) => (
              <ListRow
                key={comment.id}
                title={comment.body}
                subtitle={new Date(comment.createdAt).toLocaleString()}
                showDivider={index < commentsQuery.data.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>No comments yet.</Text>
          )}
        </Card>

        <Card className="mb-8">
          <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
            Add comment
          </Text>
          <TextInput
            value={commentDraft}
            onChangeText={setCommentDraft}
            multiline
            placeholder="Leave planning context or review guidance"
            placeholderTextColor="#7B8794"
            className="border-border mt-3 min-h-24 rounded-2xl border px-4 py-3"
            style={{ color: colors.foreground }}
          />
          <Button
            className="mt-4"
            onPress={() =>
              createCommentMutation.mutate({
                workItemId,
                body: commentDraft,
              })
            }
            disabled={!commentDraft.trim() || createCommentMutation.isPending}
          >
            Post comment
          </Button>
        </Card>
      </ScrollView>
    </Screen>
  );
}
