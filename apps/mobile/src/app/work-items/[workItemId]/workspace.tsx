import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { buildHeadlessSessionDestination } from "~/features/planning/execution-links";
import {
  DEFAULT_EXECUTION_WORKSPACE_TITLE,
  buildTaskWorkspaceViewModel,
  deriveTaskWorkspaceValidationState,
  summarizeSessionEvents,
  summarizeTaskRuns,
} from "~/features/planning/task-workspace";
import { authClient } from "~/utils/auth";
import { trpc } from "~/utils/api";
import { getBaseUrl } from "~/utils/base-url";
import { colors } from "~/lib/colors";

export default function TaskWorkspaceScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ workItemId: string }>();
  const workItemId =
    typeof params.workItemId === "string" ? params.workItemId : "";
  const queryClient = useQueryClient();
  const [messageDraft, setMessageDraft] = useState("");

  const workItemQuery = useQuery(
    trpc.workItem.get.queryOptions(
      { id: workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const taskRunsQuery = useQuery(
    trpc.taskRun.listByWorkItem.queryOptions(
      { workItemId },
      { enabled: Boolean(session && workItemId) },
    ),
  );

  const activeTaskRun = useMemo(
    () => taskRunsQuery.data?.find((run) => run.sessionId != null) ?? null,
    [taskRunsQuery.data],
  );

  const linkedSession = activeTaskRun?.sessionId ?? null;

  const workflowStateQuery = useQuery(
    trpc.session.getWorkflowState.queryOptions(
      { sessionId: linkedSession ?? "" },
      { enabled: Boolean(linkedSession) },
    ),
  );

  const eventsQuery = useQuery(
    trpc.session.getEvents.queryOptions(
      { sessionId: linkedSession ?? "", limit: 30 },
      { enabled: Boolean(linkedSession) },
    ),
  );

  const sendInputMutation = useMutation(
    trpc.session.sendHeadlessInput.mutationOptions({
      onSuccess: async () => {
        setMessageDraft("");
        if (!linkedSession) return;
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.session.getEvents.queryKey({
              sessionId: linkedSession,
              limit: 30,
            }),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.session.getWorkflowState.queryKey({
              sessionId: linkedSession,
            }),
          }),
        ]);
      },
    }),
  );

  const resolveAwaitingInputMutation = useMutation(
    trpc.session.resolveAwaitingInput.mutationOptions({
      onSuccess: async () => {
        if (!linkedSession) return;
        await queryClient.invalidateQueries({
          queryKey: trpc.session.getWorkflowState.queryKey({
            sessionId: linkedSession,
          }),
        });
      },
    }),
  );

  const workspaceModel = useMemo(() => {
    if (!workItemQuery.data) {
      return null;
    }

    return buildTaskWorkspaceViewModel({
      workItem: {
        id: workItemQuery.data.workItem.id,
        identifier: workItemQuery.data.workItem.identifier,
        title: workItemQuery.data.workItem.title,
      },
      session: linkedSession
        ? {
            id: linkedSession,
            title: `${workItemQuery.data.workItem.identifier} execution`,
            status: activeTaskRun?.status ?? "running",
          }
        : null,
      workflowState: workflowStateQuery.data
        ? {
            workflowStatus: workflowStateQuery.data.workflowStatus,
            statusMessage: workflowStateQuery.data.statusMessage ?? null,
            awaitingInput: workflowStateQuery.data.awaitingInput
              ? {
                  question: workflowStateQuery.data.awaitingInput.question,
                  defaultAction:
                    workflowStateQuery.data.awaitingInput.defaultAction,
                  expiresAt:
                    workflowStateQuery.data.awaitingInput.expiresAt.toISOString(),
                }
              : null,
          }
        : null,
      currentArtifacts: workItemQuery.data.currentArtifacts.map((artifact) => ({
        id: artifact.id,
        artifactRole: artifact.artifactRole,
        artifactType: artifact.artifactType,
        title: artifact.title,
        url: artifact.url,
      })),
      events: (eventsQuery.data?.events ?? []).map((event) => ({
        seq: event.seq,
        direction: event.direction,
        eventType: event.eventType,
        payload: event.payload as Record<string, unknown>,
      })),
    });
  }, [
    activeTaskRun?.status,
    eventsQuery.data?.events,
    linkedSession,
    workItemQuery.data,
    workflowStateQuery.data,
  ]);

  const eventRows = useMemo(
    () =>
      summarizeSessionEvents(
        (eventsQuery.data?.events ?? []).map((event) => ({
          seq: event.seq,
          direction: event.direction,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
        })),
      ),
    [eventsQuery.data?.events],
  );

  const validationState = useMemo(
    () =>
      deriveTaskWorkspaceValidationState(
        (workItemQuery.data?.currentArtifacts ?? []).map((artifact) => ({
          id: artifact.id,
          artifactRole: artifact.artifactRole,
          artifactType: artifact.artifactType,
          title: artifact.title,
          summary: artifact.summary,
          url: artifact.url,
          metadata: artifact.metadata ?? null,
        })),
      ),
    [workItemQuery.data?.currentArtifacts],
  );

  const runRows = useMemo(
    () =>
      summarizeTaskRuns(
        (taskRunsQuery.data ?? []).map((run) => ({
          id: run.id,
          status: run.status,
          branch: run.branch,
          sessionId: run.sessionId,
        })),
      ),
    [taskRunsQuery.data],
  );

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
            Task not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const workItemData = workItemQuery.data;
  const awaitingInputModel = workspaceModel?.awaitingInput ?? null;
  const baseUrl = getBaseUrl();

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5">
          <Text className="text-sm uppercase tracking-[0.18em]" style={{ color: colors.muted }}>
            {workItemData.workItem.identifier}
          </Text>
          <Text className="mt-1 text-3xl font-semibold tracking-tight" style={{ color: colors.foreground }}>
            {workItemData.workItem.title}
          </Text>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>
            {workspaceModel?.title ?? DEFAULT_EXECUTION_WORKSPACE_TITLE}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge variant="accent">
              {workspaceModel?.sessionStatus.replace(/_/g, " ") ?? "not started"}
            </Badge>
            <Badge>
              {workspaceModel?.workflowStatus.replace(/_/g, " ") ?? "not started"}
            </Badge>
            <Badge variant="success">
              {workspaceModel?.artifactCount ?? 0} artifacts
            </Badge>
          </View>
          {workspaceModel?.statusMessage ? (
            <Text className="mt-4 text-sm" style={{ color: colors.muted }}>
              {workspaceModel.statusMessage}
            </Text>
          ) : null}
        </Card>

        <Card className="mb-5">
          <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
            Validation state
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge
              variant={
                validationState.tone === "positive"
                  ? "success"
                  : validationState.tone === "critical"
                    ? "danger"
                    : validationState.tone === "warning"
                      ? "warning"
                      : "default"
              }
            >
              {validationState.label}
            </Badge>
            <Badge>{workspaceModel?.artifactCount ?? 0} artifacts</Badge>
          </View>
          <Text className="mt-3 text-sm leading-6" style={{ color: colors.muted }}>
            {validationState.detail}
          </Text>
        </Card>

        {awaitingInputModel ? (
          <Card className="mb-5">
            <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
              Awaiting input
            </Text>
            <Text className="mt-3 text-sm leading-6" style={{ color: colors.muted }}>
              {awaitingInputModel.question}
            </Text>
            <Text className="mt-3 text-xs uppercase tracking-[0.16em]" style={{ color: colors.muted2 }}>
              Default: {awaitingInputModel.defaultAction}
            </Text>
            <Text className="mt-1 text-xs uppercase tracking-[0.16em]" style={{ color: colors.muted2 }}>
              Expires: {new Date(awaitingInputModel.expiresAt).toLocaleString()}
            </Text>
            <Button
              className="mt-4"
              onPress={() => {
                if (!linkedSession) {
                  return;
                }

                resolveAwaitingInputMutation.mutate({
                  sessionId: linkedSession,
                  resolution: {
                    type: "human",
                    value: awaitingInputModel.defaultAction,
                  },
                });
              }}
              disabled={!linkedSession || resolveAwaitingInputMutation.isPending}
            >
              Accept default action
            </Button>
          </Card>
        ) : null}

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Conversation</Text>
        </View>
        <Card className="mb-5">
          {eventRows.length > 0 ? (
            eventRows.map((row, index) => (
              <ListRow
                key={row.id}
                title={`${row.actor} · ${row.body}`}
                showDivider={index < eventRows.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>
              {linkedSession
                ? "No visible messages yet."
                : "No linked execution session yet for this task."}
            </Text>
          )}
        </Card>

        <Card className="mb-5">
          <Text className="text-base font-semibold" style={{ color: colors.foreground }}>
            Send message
          </Text>
          <TextInput
            value={messageDraft}
            onChangeText={setMessageDraft}
            multiline
            editable={Boolean(linkedSession)}
            placeholder={
              linkedSession
                ? "Ask Bob for an update or provide guidance"
                : "Execution chat will unlock when this task has a linked session"
            }
            placeholderTextColor="#7B8794"
            className="border-border mt-3 min-h-24 rounded-2xl border px-4 py-3"
            style={{ color: colors.foreground }}
          />
          <Button
            className="mt-4"
            onPress={() =>
              linkedSession &&
              sendInputMutation.mutate({
                sessionId: linkedSession,
                message: messageDraft,
              })
            }
            disabled={
              !linkedSession || !messageDraft.trim() || sendInputMutation.isPending
            }
          >
            Send to Bob
          </Button>
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Run history</Text>
        </View>
        <Card className="mb-5">
          {runRows.length > 0 ? (
            runRows.map((run, index) => {
              const sessionId = run.sessionId;

              return (
                <ListRow
                  key={run.id}
                  title={run.label}
                  subtitle={run.branch}
                  onPress={
                    sessionId
                      ? () => {
                          void Linking.openURL(
                            buildHeadlessSessionDestination(sessionId, baseUrl),
                          );
                        }
                      : undefined
                  }
                  right={
                    <Text className="text-sm" style={{ color: colors.muted }}>
                      {run.hasSession ? "Open run" : "Recorded"}
                    </Text>
                  }
                  showDivider={index < runRows.length - 1}
                />
              );
            })
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>
              No runs have been recorded for this task yet.
            </Text>
          )}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-semibold" style={{ color: colors.foreground }}>Artifacts</Text>
        </View>
        <Card className="mb-8">
          {workItemData.currentArtifacts.length > 0 ? (
            workItemData.currentArtifacts.map((artifact, index) => (
              <ListRow
                key={artifact.id}
                title={artifact.title ?? artifact.artifactRole}
                subtitle={artifact.url ?? undefined}
                onPress={artifact.url ? () => {
                  void Linking.openURL(artifact.url!);
                } : undefined}
                showDivider={index < workItemData.currentArtifacts.length - 1}
              />
            ))
          ) : (
            <Text className="text-sm" style={{ color: colors.muted }}>
              Verification and deliverable links will appear here.
            </Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
