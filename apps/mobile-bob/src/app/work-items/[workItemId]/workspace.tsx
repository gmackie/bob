import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, ListRow, Screen } from "~/components/ui";
import { buildHeadlessSessionDestination } from "~/features/planning/execution-links";
import { getExecutionLaunchState } from "~/features/planning/mobile-actions";
import {
  buildTaskWorkspaceViewModel,
  DEFAULT_EXECUTION_WORKSPACE_TITLE,
  deriveTaskWorkspaceValidationState,
  summarizeSessionEvents,
  summarizeTaskRuns,
} from "~/features/planning/task-workspace";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

const AGENT_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "grok", label: "Grok" },
  { id: "cursor", label: "Cursor" },
];

interface WorkspaceTaskRun {
  id: string;
  status: string;
  branch: string | null;
  sessionId: string | null;
}

interface WorkspaceSession {
  id: string;
  title: string | null;
  status: string;
  workItemId: string | null;
}

interface WorkspaceArtifact {
  id: string;
  artifactRole: string;
  artifactType: string;
  title: string | null;
  summary?: string | null;
  url: string | null;
  metadata?: Record<string, unknown> | null;
}

interface WorkspaceEvent {
  seq: number;
  direction: string;
  eventType: string;
  payload: Record<string, unknown>;
}

interface WorkspaceData {
  workItem: {
    id: string;
    identifier: string;
    title: string;
  };
  currentArtifacts: WorkspaceArtifact[];
}

interface WorkspaceWorkflowState {
  workflowStatus: string;
  statusMessage: string | null;
  awaitingInput: {
    question: string;
    defaultAction: string;
    expiresAt: Date | string;
  } | null;
}

function getDispatchSessionId(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "sessionId" in value &&
    typeof value.sessionId === "string"
  ) {
    return value.sessionId;
  }

  throw new Error("Work dispatch did not return a session id");
}

export default function TaskWorkspaceScreen() {
  const { data: session, isPending } = authClient.useSession();
  const params = useLocalSearchParams<{ workItemId: string }>();
  const workItemId =
    typeof params.workItemId === "string" ? params.workItemId : "";
  const queryClient = useQueryClient();
  const [messageDraft, setMessageDraft] = useState("");
  const [startedExecutionSessionId, setStartedExecutionSessionId] = useState<
    string | null
  >(null);
  const [executionLaunchError, setExecutionLaunchError] = useState<
    string | null
  >(null);
  const [agentType, setAgentType] = useState<string>("claude");

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

  const sessionListInput = useMemo(() => ({ limit: 50 }), []);
  const sessionsQuery = useQuery(
    trpc.session.list.queryOptions(sessionListInput, {
      enabled: Boolean(session && workItemId),
    }),
  );

  const taskRuns = useMemo(() => {
    const data: unknown = taskRunsQuery.data;
    return Array.isArray(data) ? (data as WorkspaceTaskRun[]) : [];
  }, [taskRunsQuery.data]);

  const executionSessions = useMemo(() => {
    const data = sessionsQuery.data as { items?: unknown } | undefined;
    return Array.isArray(data?.items) ? (data.items as WorkspaceSession[]) : [];
  }, [sessionsQuery.data]);

  const workspaceData = useMemo(
    () => (workItemQuery.data as WorkspaceData | null | undefined) ?? null,
    [workItemQuery.data],
  );

  const currentArtifacts = useMemo(
    () => workspaceData?.currentArtifacts ?? [],
    [workspaceData?.currentArtifacts],
  );

  const activeTaskRun = useMemo(
    () => taskRuns.find((run) => run.sessionId != null) ?? null,
    [taskRuns],
  );

  const activeExecutionSession = useMemo(
    () =>
      executionSessions.find(
        (item) =>
          item.workItemId === workItemId &&
          item.status !== "stopped" &&
          item.status !== "error",
      ) ?? null,
    [executionSessions, workItemId],
  );

  const linkedSession =
    startedExecutionSessionId ??
    activeExecutionSession?.id ??
    activeTaskRun?.sessionId ??
    null;

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

  const sessionEvents = useMemo(() => {
    const data = eventsQuery.data as { events?: unknown } | undefined;
    return Array.isArray(data?.events) ? (data.events as WorkspaceEvent[]) : [];
  }, [eventsQuery.data]);

  const workflowStateData =
    (workflowStateQuery.data as WorkspaceWorkflowState | null | undefined) ??
    null;

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

  const dispatchWorkMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onMutate: () => {
        setExecutionLaunchError(null);
      },
      onSuccess: async (result: unknown) => {
        const sessionId = getDispatchSessionId(result);
        setStartedExecutionSessionId(sessionId);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.session.list.queryKey(sessionListInput),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.taskRun.listByWorkItem.queryKey({ workItemId }),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.workItem.get.queryKey({ id: workItemId }),
          }),
        ]);
      },
      onError: (error: unknown) => {
        setExecutionLaunchError(
          error instanceof Error ? error.message : "Failed to start work",
        );
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
    if (!workspaceData) {
      return null;
    }

    return buildTaskWorkspaceViewModel({
      workItem: {
        id: workspaceData.workItem.id,
        identifier: workspaceData.workItem.identifier,
        title: workspaceData.workItem.title,
      },
      session: linkedSession
        ? {
            id: linkedSession,
            title:
              activeExecutionSession?.title ??
              `${workspaceData.workItem.identifier} execution`,
            status:
              activeExecutionSession?.status ??
              activeTaskRun?.status ??
              "running",
          }
        : null,
      workflowState: workflowStateData
        ? {
            workflowStatus: workflowStateData.workflowStatus,
            statusMessage: workflowStateData.statusMessage ?? null,
            awaitingInput: workflowStateData.awaitingInput
              ? {
                  question: workflowStateData.awaitingInput.question,
                  defaultAction: workflowStateData.awaitingInput.defaultAction,
                  expiresAt:
                    workflowStateData.awaitingInput.expiresAt instanceof Date
                      ? workflowStateData.awaitingInput.expiresAt.toISOString()
                      : workflowStateData.awaitingInput.expiresAt,
                }
              : null,
          }
        : null,
      currentArtifacts: currentArtifacts.map((artifact) => ({
        id: artifact.id,
        artifactRole: artifact.artifactRole,
        artifactType: artifact.artifactType,
        title: artifact.title,
        url: artifact.url,
      })),
      events: sessionEvents.map((event) => ({
        seq: event.seq,
        direction: event.direction,
        eventType: event.eventType,
        payload: event.payload,
      })),
    });
  }, [
    activeTaskRun?.status,
    activeExecutionSession?.status,
    activeExecutionSession?.title,
    currentArtifacts,
    linkedSession,
    sessionEvents,
    workspaceData,
    workflowStateData,
  ]);

  const eventRows = useMemo(
    () =>
      summarizeSessionEvents(
        sessionEvents.map((event) => ({
          seq: event.seq,
          direction: event.direction,
          eventType: event.eventType,
          payload: event.payload,
        })),
      ),
    [sessionEvents],
  );

  const validationState = useMemo(
    () =>
      deriveTaskWorkspaceValidationState(
        currentArtifacts.map((artifact) => ({
          id: artifact.id,
          artifactRole: artifact.artifactRole,
          artifactType: artifact.artifactType,
          title: artifact.title,
          summary: artifact.summary,
          url: artifact.url,
          metadata: artifact.metadata ?? null,
        })),
      ),
    [currentArtifacts],
  );

  const runRows = useMemo(
    () =>
      summarizeTaskRuns(
        taskRuns.map((run) => ({
          id: run.id,
          status: run.status,
          branch: run.branch,
          sessionId: run.sessionId,
        })),
      ),
    [taskRuns],
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

  if (!workspaceData) {
    return (
      <Screen className="justify-center">
        <Card className="items-center">
          <Text className="text-foreground text-lg font-semibold">
            Task not found
          </Text>
        </Card>
      </Screen>
    );
  }

  const workItemData = workspaceData;
  const awaitingInputModel = workspaceModel?.awaitingInput ?? null;
  const baseUrl = getBaseUrl();
  const executionLaunchState = getExecutionLaunchState({
    linkedSessionId: linkedSession,
    isPending: dispatchWorkMutation.isPending,
  });

  return (
    <Screen className="pt-6">
      <ScrollView showsVerticalScrollIndicator={false}>
        <View className="mb-5">
          <Text className="text-muted text-sm tracking-[0.18em] uppercase">
            {workItemData.workItem.identifier}
          </Text>
          <Text className="text-foreground mt-1 text-3xl font-semibold tracking-tight">
            {workItemData.workItem.title}
          </Text>
        </View>

        <Card variant="elevated" className="mb-5">
          <Text className="text-foreground text-lg font-semibold">
            {workspaceModel?.title ?? DEFAULT_EXECUTION_WORKSPACE_TITLE}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge variant="accent">
              {workspaceModel?.sessionStatus.replace(/_/g, " ") ??
                "not started"}
            </Badge>
            <Badge>
              {workspaceModel?.workflowStatus.replace(/_/g, " ") ??
                "not started"}
            </Badge>
            <Badge variant="success">
              {workspaceModel?.artifactCount ?? 0} artifacts
            </Badge>
          </View>
          {workspaceModel?.statusMessage ? (
            <Text className="text-muted mt-4 text-sm">
              {workspaceModel.statusMessage}
            </Text>
          ) : null}
          {!linkedSession ? (
            <>
              <View className="mt-4 flex-row items-center flex-wrap gap-2">
                <Text className="text-muted mr-1 text-xs">Agent:</Text>
                {AGENT_OPTIONS.map((opt) => {
                  const selected = opt.id === agentType;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setAgentType(opt.id)}
                      disabled={dispatchWorkMutation.isPending}
                      className={`rounded-full border px-3 py-1 ${
                        selected
                          ? "border-primary bg-primary/15"
                          : "border-border"
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          selected ? "text-foreground" : "text-muted"
                        }`}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                className="mt-4"
                onPress={() => {
                  dispatchWorkMutation.mutate({ workItemId, agentType });
                }}
                disabled={executionLaunchState.disabled}
              >
                {executionLaunchState.label}
              </Button>
              {executionLaunchError ? (
                <Text className="text-danger mt-3 text-sm">
                  {executionLaunchError}
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card className="mb-5">
          <Text className="text-foreground text-base font-semibold">
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
          <Text className="text-muted mt-3 text-sm leading-6">
            {validationState.detail}
          </Text>
        </Card>

        {awaitingInputModel ? (
          <Card className="mb-5">
            <Text className="text-foreground text-base font-semibold">
              Awaiting input
            </Text>
            <Text className="text-muted mt-3 text-sm leading-6">
              {awaitingInputModel.question}
            </Text>
            <Text className="text-muted2 mt-3 text-xs tracking-[0.16em] uppercase">
              Default: {awaitingInputModel.defaultAction}
            </Text>
            <Text className="text-muted2 mt-1 text-xs tracking-[0.16em] uppercase">
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
              disabled={
                !linkedSession || resolveAwaitingInputMutation.isPending
              }
            >
              Accept default action
            </Button>
          </Card>
        ) : null}

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">
            Conversation
          </Text>
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
            <Text className="text-muted text-sm">
              {linkedSession
                ? "No visible messages yet."
                : "No linked execution session yet for this task."}
            </Text>
          )}
        </Card>

        <Card className="mb-5">
          <Text className="text-foreground text-base font-semibold">
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
            className="border-border text-foreground mt-3 min-h-24 rounded-2xl border px-4 py-3"
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
              !linkedSession ||
              !messageDraft.trim() ||
              sendInputMutation.isPending
            }
          >
            Send to Bob
          </Button>
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">
            Run history
          </Text>
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
                    <Text className="text-muted text-sm">
                      {run.hasSession ? "Open run" : "Recorded"}
                    </Text>
                  }
                  showDivider={index < runRows.length - 1}
                />
              );
            })
          ) : (
            <Text className="text-muted text-sm">
              No runs have been recorded for this task yet.
            </Text>
          )}
        </Card>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-foreground text-lg font-semibold">
            Artifacts
          </Text>
        </View>
        <Card className="mb-8">
          {currentArtifacts.length > 0 ? (
            currentArtifacts.map((artifact, index) => {
              const artifactUrl = artifact.url;

              return (
                <ListRow
                  key={artifact.id}
                  title={artifact.title ?? artifact.artifactRole}
                  subtitle={artifactUrl ?? undefined}
                  onPress={
                    artifactUrl
                      ? () => {
                          void Linking.openURL(artifactUrl);
                        }
                      : undefined
                  }
                  showDivider={index < currentArtifacts.length - 1}
                />
              );
            })
          ) : (
            <Text className="text-muted text-sm">
              Verification and deliverable links will appear here.
            </Text>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
