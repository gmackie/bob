import { Redirect, router, useLocalSearchParams } from "expo-router";
import { colors } from "~/lib/colors";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { LinkedExecutionRunsCard } from "~/components/tablet/LinkedExecutionRunsCard";
import { OutcomeReadableOutputCard } from "~/components/tablet/OutcomeReadableOutputCard";
import {
  buildMobileChildDispatchRequests,
  formatMobileDispatchAgentLabel,
  getMobileWorkItemDispatchAgentType,
  getWorkItemDetailPresentation,
} from "~/features/planning/work-item-detail";
import { getTaskWorkspaceHref, getWorkItemHref } from "~/features/planning/navigation";
import {
  buildMobileWorkItemEntryItem,
  buildMobileWorkItemEntryContext,
  getMobileWorkItemEntryAction,
  getMobileWorkItemEntryValidationState,
  getMobileWorkItemDispatchSuccessHref,
  normalizeMobileWorkItemEntryView

} from "~/features/tablet/work-item-entry";
import type {MobileWorkItemEntryValidationState} from "~/features/tablet/work-item-entry";
import { getMobileDetailBackAction } from "~/features/tablet/navigation";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";

const PIPELINE_STAGES = [
  { key: "idea", label: "Idea" },
  { key: "shape", label: "Shape" },
  { key: "plan", label: "Plan" },
  { key: "execute", label: "Execute" },
  { key: "review", label: "Review" },
  { key: "deploy", label: "Deploy" },
  { key: "live", label: "Live" },
] as const;

interface MobileChildWorkItem {
  id: string;
  identifier?: string | null;
  title: string;
  kind: string;
  status: string;
}

interface MobileArtifact {
  id: string;
  title?: string | null;
  artifactRole: string;
  artifactType?: string | null;
  summary?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface MobileComment {
  id: string;
  body: string;
  createdAt: string | Date;
}

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
  const params = useLocalSearchParams<{ workItemId: string; view?: string }>();
  const workItemId =
    typeof params.workItemId === "string" ? params.workItemId : "";
  const entryView = normalizeMobileWorkItemEntryView(params.view);
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
  const dispatchTaskMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.get.queryKey({ id: workItemId }),
        });
        const workspaceId = workItemQuery.data?.workItem?.workspaceId ?? null;
        router.push(
          getMobileWorkItemDispatchSuccessHref({
            workItemId,
            workspaceId,
            result,
          }) as never,
        );
      },
    }),
  );

  const [dispatching, setDispatching] = useState(false);

  // Fetch child work items for epic/issue pipeline view
  const childListInput = {
    workspaceId: workItemQuery.data?.workItem?.workspaceId ?? "",
    parentId: workItemId,
    limit: 50,
  };
  const childItemsQuery = useQuery(
    trpc.workItem.list.queryOptions(
      childListInput,
      { enabled: Boolean(session && workItemId && workItemQuery.data?.workItem?.kind !== "task") },
    ),
  );
  const dispatchChildTaskMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.workItem.list.queryKey(childListInput),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.workItem.get.queryKey({ id: workItemId }),
          }),
        ]);
      },
    }),
  );
  const childItems = useMemo(
    () => (Array.isArray(childItemsQuery.data) ? (childItemsQuery.data as MobileChildWorkItem[]) : []),
    [childItemsQuery.data],
  );
  const comments = useMemo(
    () => (Array.isArray(commentsQuery.data) ? (commentsQuery.data as MobileComment[]) : []),
    [commentsQuery.data],
  );

  const pipelineDetection = useMemo(() => {
    if (!workItemQuery.data || workItemQuery.data.workItem.kind === "task") return null;
    return detectMobileStage({
      childCount: childItems.length,
      artifactCount: workItemQuery.data.currentArtifacts.length,
      childStatuses: childItems.map((child) => child.status),
    });
  }, [childItems, workItemQuery.data]);

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
          <Text className="text-lg font-semibold text-foreground">
            Work item not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const { workItem, currentArtifacts, childCount } = workItemQuery.data;
  const artifacts = Array.isArray(currentArtifacts)
    ? (currentArtifacts as MobileArtifact[])
    : [];
  const entryItem = buildMobileWorkItemEntryItem(workItem);
  const entryContext = buildMobileWorkItemEntryContext({
    view: entryView,
    workItem: entryItem,
  });
  const backAction = getMobileDetailBackAction({
    source: "work-item",
    view: entryView,
    workspaceId: workItem.workspaceId ?? null,
  });
  const entryAction = getMobileWorkItemEntryAction({
    view: entryView,
    workspaceId: workItem.workspaceId ?? null,
    workItem: entryItem,
  });
  const validationState = getMobileWorkItemEntryValidationState(artifacts);
  const showValidationState = entryContext.sections.some(
    (section) =>
      section.key === "artifacts-validation" || section.key === "validation-review",
  );
  const detailPresentation = getWorkItemDetailPresentation({
    id: workItem.id,
    kind: workItem.kind,
    workspaceId: workItem.workspaceId,
  });
  const childDispatchAgentType = getMobileWorkItemDispatchAgentType(workItem.project);
  const childDispatchRequests = buildMobileChildDispatchRequests(
    childItems,
    childDispatchAgentType,
  );
  const childDispatchAgentLabel = formatMobileDispatchAgentLabel(childDispatchAgentType);

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5 flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-sm uppercase tracking-[0.18em] text-muted">
              {workItem.identifier}
            </Text>
            <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
              {workItem.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backAction.accessibilityLabel}
            onPress={() => router.replace(backAction.href as never)}
            className="rounded-md px-3 py-2 active:opacity-70"
            style={{ backgroundColor: colors.secondary }}
          >
            <Text className="text-sm font-semibold text-foreground">{backAction.label}</Text>
          </Pressable>
        </View>
        <View className="mb-5">
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge variant="accent">{workItem.kind}</Badge>
            <Badge>{workItem.status.replace(/_/g, " ")}</Badge>
            {workItem.project ? (
              <Badge variant="success">{workItem.project.key}</Badge>
            ) : null}
          </View>
        </View>

        <Card className="mb-5">
          <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            {entryContext.sourceLabel}
          </Text>
          <Text className="mt-2 text-base font-semibold text-foreground">
            {entryContext.heading}
          </Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
            {entryContext.description}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {entryContext.facts.map((fact) => (
              <Badge key={fact.label}>
                {fact.label}: {fact.value}
              </Badge>
            ))}
          </View>
          <View
            className="mt-4 pt-4"
            style={{ borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              Detail sections
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {entryContext.sections.map((section) => (
                <Badge key={section.key}>{section.label}</Badge>
              ))}
            </View>
          </View>
          {entryContext.dependencySummary ? (
            <View
              className="mt-4 pt-4"
              style={{ borderTopWidth: 1, borderTopColor: colors.border }}
            >
              <RelatedWorkItemsList
                title="Depends On"
                empty="No dependencies"
                items={entryContext.dependencySummary.dependencies}
              />
              <RelatedWorkItemsList
                title="Blocking"
                empty="No blocked tasks"
                items={entryContext.dependencySummary.dependents}
              />
            </View>
          ) : null}
          {entryAction.kind === "dispatch" || entryAction.kind === "rerun" ? (
            <Button
              className="mt-4"
              onPress={() => dispatchTaskMutation.mutate({ workItemId })}
              disabled={dispatchTaskMutation.isPending}
            >
              {dispatchTaskMutation.isPending ? "Starting..." : entryAction.label}
            </Button>
          ) : entryAction.kind === "live-session" ? (
            <Button
              className="mt-4"
              onPress={() => router.push(entryAction.href as never)}
            >
              {entryAction.label}
            </Button>
          ) : null}
          {showValidationState ? (
            <ValidationStateCard validationState={validationState} />
          ) : null}
        </Card>

        {entryView === "outcome" ? (
          <OutcomeReadableOutputCard
            workItemId={workItem.id}
            onOpenSession={(sessionId) =>
              router.push(getSessionHref(sessionId, workItem.workspaceId) as never)
            }
          />
        ) : null}

        {entryView === "queue" ? (
          <LinkedExecutionRunsCard
            workItemId={workItem.id}
            workspaceId={workItem.workspaceId ?? null}
            onOpenSession={(sessionId) =>
              router.push(getSessionHref(sessionId, workItem.workspaceId) as never)
            }
          />
        ) : null}

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
            <Text className="text-base font-semibold text-foreground">
              Description
            </Text>
            <Text className="mt-3 text-sm leading-6 text-muted">
              {workItem.description}
            </Text>
          </Card>
        ) : null}

        {/* Child tasks (for epics/issues) */}
        {childItems.length > 0 ? (
          <View className="mb-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-foreground">
                Tasks ({childItems.filter((child) => child.status === "done").length}/{childItems.length})
              </Text>
              {pipelineDetection?.stage === "plan" ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={dispatching || childDispatchRequests.length === 0}
                  onPress={async () => {
                    setDispatching(true);
                    try {
                      for (const request of childDispatchRequests) {
                        await dispatchChildTaskMutation.mutateAsync(request);
                      }
                    } finally {
                      setDispatching(false);
                    }
                    await queryClient.invalidateQueries({
                      queryKey: trpc.workItem.list.queryKey(childListInput),
                    });
                  }}
                >
                  {dispatching ? "Dispatching..." : `Dispatch ${childDispatchAgentLabel}`}
                </Button>
              ) : null}
            </View>
            <Card>
              {childItems.map((child, index) => (
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
                        ? getTaskWorkspaceHref(child.id, workItem.workspaceId)
                        : getWorkItemHref(child.id, workItem.workspaceId)) as never,
                    )
                  }
                  showDivider={index < childItems.length - 1}
                />
              ))}
            </Card>
          </View>
        ) : null}

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold text-foreground">
            Planning context
          </Text>
          <Text className="mt-3 text-sm text-muted">
            {childCount} child items · {artifacts.length} current artifacts
          </Text>
          <Text className="mt-4 text-sm font-semibold text-foreground">
            {detailPresentation.semanticSummary}
          </Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
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
          <Text className="text-lg font-semibold text-foreground">Artifacts</Text>
        </View>
        <Card className="mb-5">
          {artifacts.length > 0 ? (
            artifacts.map((artifact, index) => (
              <ListRow
                key={artifact.id}
                title={artifact.title ?? artifact.artifactRole}
                subtitle={artifact.url ?? undefined}
                showDivider={index < artifacts.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm text-muted">No artifacts attached yet.</Text>
          )}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-foreground">Comments</Text>
        </View>
        <Card className="mb-4">
          {comments.length ? (
            comments.map((comment, index) => (
              <ListRow
                key={comment.id}
                title={comment.body}
                subtitle={new Date(comment.createdAt).toLocaleString()}
                showDivider={index < comments.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm text-muted">No comments yet.</Text>
          )}
        </Card>

        <Card className="mb-8">
          <Text className="text-base font-semibold text-foreground">
            Add comment
          </Text>
          <TextInput
            value={commentDraft}
            onChangeText={setCommentDraft}
            multiline
            placeholder="Leave planning context or review guidance"
            placeholderTextColor="#7B8794"
            className="border-border mt-3 min-h-24 rounded-2xl border px-4 py-3 text-foreground"
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

function ValidationStateCard({
  validationState,
}: {
  validationState: MobileWorkItemEntryValidationState;
}) {
  const toneColor =
    validationState.tone === "positive"
      ? colors.success
      : validationState.tone === "critical"
        ? colors.danger
        : validationState.tone === "warning"
          ? colors.warning
          : colors.muted;

  return (
    <View
      className="mt-4 rounded-lg border p-3"
      style={{
        borderColor: `${toneColor}66`,
        backgroundColor: `${toneColor}18`,
      }}
    >
      <Text className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        Validation state
      </Text>
      <Text className="mt-2 text-sm font-semibold text-foreground">
        {validationState.label}
      </Text>
      <Text className="mt-2 text-sm leading-6" style={{ color: toneColor }}>
        {validationState.detail}
      </Text>
    </View>
  );
}

function RelatedWorkItemsList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; identifier: string; title: string; statusLabel: string }[];
}) {
  return (
    <View className="mb-4">
      <Text className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        {title}
      </Text>
      {items.length === 0 ? (
        <View
          className="rounded-lg border p-3"
          style={{ borderColor: colors.border }}
        >
          <Text className="text-xs text-muted">{empty}</Text>
        </View>
      ) : (
        <View className="gap-2">
          {items.map((item) => (
            <View
              key={item.id}
              className="rounded-lg border p-3"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
            >
              <Text className="text-sm font-semibold text-foreground">
                {item.identifier} · {item.title}
              </Text>
              <Text className="mt-1 text-xs text-muted">
                {item.statusLabel}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function getSessionHref(sessionId: string, workspaceId?: string | null): string {
  if (!workspaceId) return `/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/sessions/${sessionId}?${params.toString()}`;
}
