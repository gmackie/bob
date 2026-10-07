import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { GatewaySession } from "~/hooks/use-gateway";
import type {
  PlanPanelMode,
  PlanRunWatchTarget,
  PlanStatusTone,
} from "~/features/planning/plan-execution";
import {
  buildCreateBatchInput,
  buildPlanExecutionView,
  findBatchForPlanningSession,
  parseBatchList,
  parseCommitPlanResult,
  parseCommittedPlanTasks,
  parseDispatchBatch,
  parsePlanningDrafts,
  shouldPollBatchProgress,
} from "~/features/planning/plan-execution";
import { colors } from "~/lib/colors";
import { rpc } from "~/utils/api";

const TONE_COLORS: Record<PlanStatusTone, string> = {
  default: colors.muted,
  warning: colors.warning,
  success: colors.success,
  danger: colors.danger,
};

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function PlanExecutionPanel({
  sessionId,
  sessions,
  presentation,
  onToggle,
  onOpenRun,
}: {
  sessionId: string;
  sessions: readonly GatewaySession[];
  presentation: PlanPanelMode;
  onToggle: () => void;
  onOpenRun: (run: PlanRunWatchTarget) => void;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [createdBatchId, setCreatedBatchId] = useState<string | null>(null);

  const sessionQuery = useQuery(
    rpc("planning.session.get").queryOptions(
      { sessionId },
      { refetchInterval: 5_000 },
    ),
  );
  const batchListQuery = useQuery(
    rpc("planning.dispatch.listBatches").queryOptions(
      { limit: 50 },
      { refetchInterval: createdBatchId ? false : 15_000 },
    ),
  );

  const listedBatchId =
    findBatchForPlanningSession(parseBatchList(batchListQuery.data), sessionId)?.id ??
    null;
  const batchId = createdBatchId ?? listedBatchId;

  const batchQuery = useQuery(
    rpc("planning.dispatch.getBatch").queryOptions(
      { batchId: batchId ?? "" },
      {
        enabled: Boolean(batchId),
        refetchInterval: 5_000,
      },
    ),
  );

  const drafts = parsePlanningDrafts(sessionQuery.data);
  const readyTasks = parseCommittedPlanTasks(sessionQuery.data);
  const batch = batchId
    ? parseDispatchBatch(batchQuery.data, sessions, sessionId)
    : null;
  const createTasks = useMutation(rpc("planning.session.commitPlan").mutationOptions());
  const createBatch = useMutation(rpc("planning.dispatch.createBatch").mutationOptions());
  const runBatch = useMutation(rpc("planning.dispatch.dispatch").mutationOptions());
  const checkProgress = useMutation(
    rpc("planning.dispatch.checkProgress").mutationOptions(),
  );
  const { mutate: refreshProgress } = checkProgress;

  useEffect(() => {
    if (!batchId || !shouldPollBatchProgress(batch?.status)) return;
    refreshProgress({ batchId });
    const timer = setInterval(() => refreshProgress({ batchId }), 15_000);
    return () => clearInterval(timer);
  }, [batch?.status, batchId, refreshProgress]);

  const view = buildPlanExecutionView({
    isLoading: sessionQuery.isLoading || (Boolean(batchId) && batchQuery.isLoading),
    loadError: sessionQuery.isError
      ? errorMessage(sessionQuery.error, "The plan could not be loaded.")
      : batchQuery.isError
        ? errorMessage(batchQuery.error, "The run could not be loaded.")
        : null,
    actionError,
    drafts,
    readyTasks,
    batch,
    isCreating: createTasks.isPending || createBatch.isPending,
    isRunning: runBatch.isPending,
  });

  const refreshPlan = async () => {
    await queryClient.invalidateQueries({
      queryKey: rpc("planning.session.get").queryKey({ sessionId }),
    });
    await queryClient.invalidateQueries({
      queryKey: rpc("planning.dispatch.listBatches").queryKey({ limit: 50 }),
    });
    if (batchId) {
      await queryClient.invalidateQueries({
        queryKey: rpc("planning.dispatch.getBatch").queryKey({ batchId }),
      });
    }
  };

  const handleCreate = async () => {
    setActionError(null);
    try {
      const committed = parseCommitPlanResult(
        await createTasks.mutateAsync({ sessionId }),
      );
      const refreshed = await sessionQuery.refetch();
      const stored = parseCommittedPlanTasks(refreshed.data);
      const tasks = new Map(
        [...stored, ...(committed?.tasks ?? [])].map((task) => [task.draftId, task]),
      );
      if (tasks.size === 0) {
        setActionError("No tasks were created. Keep planning until Bob drafts some.");
        return;
      }
      const created = await createBatch.mutateAsync(
        buildCreateBatchInput(sessionId, [...tasks.values()]),
      );
      const createdBatch = parseDispatchBatch(created, sessions, sessionId);
      if (!createdBatch) {
        setActionError("The tasks were created, but the run could not be prepared.");
        await refreshPlan();
        return;
      }
      setCreatedBatchId(createdBatch.id);
      await refreshPlan();
    } catch (caught) {
      setActionError(errorMessage(caught, "The tasks could not be created."));
    }
  };

  const handleRun = async () => {
    setActionError(null);
    try {
      let activeBatchId = batchId;
      if (!activeBatchId) {
        if (readyTasks.length === 0) return;
        const created = await createBatch.mutateAsync(
          buildCreateBatchInput(sessionId, readyTasks),
        );
        const createdBatch = parseDispatchBatch(created, sessions, sessionId);
        if (!createdBatch) {
          setActionError("The tasks were created, but the run could not be prepared.");
          await refreshPlan();
          return;
        }
        activeBatchId = createdBatch.id;
        setCreatedBatchId(activeBatchId);
      }
      await runBatch.mutateAsync({ batchId: activeBatchId });
      refreshProgress({ batchId: activeBatchId });
      await refreshPlan();
    } catch (caught) {
      setActionError(errorMessage(caught, "Bob could not start the run."));
    }
  };

  const handlePrimary = () => {
    if (view.primaryAction.key === "create") void handleCreate();
    if (view.primaryAction.key === "run") void handleRun();
  };

  const primaryButton =
    view.primaryAction.key === "none" ? null : (
      <Pressable
        testID={
          view.primaryAction.key === "create" ? "plan-create-tasks" : "plan-run-tasks"
        }
        accessibilityRole="button"
        accessibilityLabel={view.primaryAction.label}
        accessibilityState={{ disabled: view.primaryAction.disabled }}
        disabled={view.primaryAction.disabled}
        onPress={handlePrimary}
        className="rounded-md px-3 py-2 active:opacity-80"
        style={{
          backgroundColor: colors.primary,
          minHeight: 44,
          justifyContent: "center",
          opacity: view.primaryAction.disabled ? 0.55 : 1,
        }}
      >
        <Text className="text-center text-sm font-semibold" style={{ color: colors.primaryForeground }}>
          {view.primaryAction.label}
        </Text>
      </Pressable>
    );

  if (presentation === "bar") {
    return (
      <View
        testID="plan-tasks-panel"
        className="flex-row items-center gap-3 px-4 py-3"
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${view.title}. ${view.detail}. Show tasks`}
          onPress={onToggle}
          className="min-w-0 flex-1 active:opacity-80"
        >
          <Text className="text-sm font-semibold text-foreground">{view.title}</Text>
          <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
            {view.detail}
          </Text>
        </Pressable>
        {primaryButton}
      </View>
    );
  }

  return (
    <View
      testID="plan-tasks-panel"
      className="min-h-0 flex-1"
      style={{ backgroundColor: colors.card }}
    >
      <View
        className="flex-row items-start justify-between gap-3 px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            presentation === "expanded" ? "Hide tasks" : view.title
          }
          onPress={presentation === "expanded" ? onToggle : undefined}
          disabled={presentation !== "expanded"}
          className="min-w-0 flex-1"
        >
          <Text className="text-sm font-semibold text-foreground">{view.title}</Text>
          <Text className="mt-0.5 text-xs text-muted">{view.detail}</Text>
        </Pressable>
        {presentation === "expanded" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hide tasks"
            onPress={onToggle}
            className="rounded-md px-3 py-2 active:opacity-80"
            style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
          >
            <Text className="text-xs font-semibold text-foreground">Hide</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 12, gap: 8 }}>
        {view.phase === "loading" ? (
          <ActivityIndicator color={colors.muted} />
        ) : null}

        {view.phase === "empty" ? (
          <Text className="px-1 py-2 text-sm text-muted">{view.detail}</Text>
        ) : null}

        {view.drafts.map((draft) => (
          <View
            key={draft.id}
            className="rounded-lg border px-3 py-2.5"
            style={{ borderColor: colors.border, backgroundColor: colors.background }}
          >
            <Text className="text-sm font-medium text-foreground">{draft.title}</Text>
            <Text className="mt-1 text-xs text-muted">{draft.meta}</Text>
            {draft.description ? (
              <Text className="mt-1.5 text-xs text-muted" numberOfLines={3}>
                {draft.description}
              </Text>
            ) : null}
            {draft.blockedBy.length > 0 ? (
              <Text className="mt-1 text-xs" style={{ color: colors.warning }}>
                Waiting on {draft.blockedBy.join(", ")}
              </Text>
            ) : null}
          </View>
        ))}

        {view.batch?.items.map((item) => {
          const watchSessionId = item.watchSessionId;
          const body = (
            <>
              <View className="flex-row items-start justify-between gap-2">
                <Text className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {item.title}
                </Text>
                <Text
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    color: TONE_COLORS[item.tone],
                    backgroundColor: `${TONE_COLORS[item.tone]}20`,
                  }}
                >
                  {item.statusLabel}
                </Text>
              </View>
              <Text className="mt-1 text-xs text-muted">
                {item.identifier || "Task"}
                {watchSessionId ? " · Watch" : ""}
              </Text>
            </>
          );

          if (!watchSessionId) {
            return (
              <View
                key={item.id}
                className="rounded-lg border px-3 py-2.5"
                style={{ borderColor: colors.border, backgroundColor: colors.background }}
              >
                {body}
              </View>
            );
          }

          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Watch ${item.title}`}
              onPress={() =>
                onOpenRun({
                  sessionId: watchSessionId,
                  title: item.title,
                  identifier: item.identifier,
                })
              }
              className="rounded-lg border px-3 py-2.5 active:opacity-80"
              style={{ borderColor: colors.border, backgroundColor: colors.background }}
            >
              {body}
            </Pressable>
          );
        })}

        {view.error ? (
          <Text className="px-1 text-sm" style={{ color: colors.danger }}>
            {view.error}
          </Text>
        ) : null}
      </ScrollView>

      {primaryButton ? (
        <View
          className="px-4 py-3"
          style={{ borderTopWidth: 1, borderTopColor: colors.border }}
        >
          {primaryButton}
        </View>
      ) : null}
    </View>
  );
}
