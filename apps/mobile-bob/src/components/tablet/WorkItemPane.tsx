import { Text, View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { trpc } from "~/utils/api";
import { colors } from "~/lib/colors";
import { LinkedExecutionRunsCard } from "./LinkedExecutionRunsCard";
import { OutcomeReadableOutputCard } from "./OutcomeReadableOutputCard";
import {
  formatStatusLabel,
  unwrapWorkItemDetail,
} from "~/features/tablet/queue";
import {
  buildMobileWorkItemEntryContext,
  getMobileWorkItemEntryAction,
  getMobileWorkItemEntryValidationState,
  type MobileWorkItemEntryValidationState,
  type MobileWorkItemEntryView,
} from "~/features/tablet/work-item-entry";

const STATUS_COLORS: Record<string, string> = {
  in_progress: colors.success,
  in_review: colors.accent,
  blocked: colors.warning,
  done: colors.muted,
  cancelled: colors.muted2,
  backlog: colors.muted2,
  ready: colors.primary,
};

interface WorkItemPaneProps {
  workItemId: string;
  entryView?: MobileWorkItemEntryView;
  onOpenInspector?: () => void;
  onOpenSession?: (sessionId: string) => void;
}

export function WorkItemPane({
  workItemId,
  entryView = "planning",
  onOpenInspector,
  onOpenSession,
}: WorkItemPaneProps) {
  const queryClient = useQueryClient();
  const workItemQuery = useQuery(trpc.workItem.get.queryOptions(
    { id: workItemId },
    { enabled: Boolean(workItemId) },
  ));
  const dispatchMutation = useMutation(
    trpc.workItem.dispatch.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workItem.get.queryKey({ id: workItemId }),
        });
        if (typeof result.sessionId === "string") {
          onOpenSession?.(result.sessionId);
        }
      },
    }),
  );

  if (workItemQuery.isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  const item = unwrapWorkItemDetail(workItemQuery.data);
  if (!item) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <Text className="text-sm text-muted">Work item not found</Text>
      </View>
    );
  }
  const entryContext = buildMobileWorkItemEntryContext({ view: entryView, workItem: item });
  const entryAction = getMobileWorkItemEntryAction({
    view: entryView,
    workspaceId: (item as { workspaceId?: string | null }).workspaceId ?? null,
    workItem: item,
  });
  const validationState = getMobileWorkItemEntryValidationState(item.currentArtifacts ?? []);
  const showValidationState = entryContext.sections.some(
    (section) =>
      section.key === "artifacts-validation" || section.key === "validation-review",
  );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
            {item.title}
          </Text>
          <View className="mt-1 flex-row items-center">
            <Text className="text-xs text-muted">
              {item.identifier}
            </Text>
            <View
              className="mx-2 rounded-full px-2 py-0.5"
              style={{ backgroundColor: (STATUS_COLORS[item.status] ?? colors.muted) + "20" }}
            >
              <Text className="text-xs font-medium" style={{ color: STATUS_COLORS[item.status] ?? colors.muted }}>
                {formatStatusLabel(item.status)}
              </Text>
            </View>
            <Text className="text-xs text-muted2">
              {item.kind}
            </Text>
          </View>
        </View>
        {onOpenInspector && (
          <Pressable
            onPress={onOpenInspector}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{ backgroundColor: colors.secondary, minHeight: 44, justifyContent: "center" }}
          >
            <Text className="text-xs font-medium text-foreground">
              Inspect
            </Text>
          </Pressable>
        )}
      </View>

      {/* Content */}
      <ScrollView className="flex-1 px-4 pt-4">
        <View
          className="mb-4 rounded-lg border p-3"
          style={{ borderColor: colors.border, backgroundColor: colors.card }}
        >
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {entryContext.sourceLabel}
          </Text>
          <Text className="mt-1 text-sm font-semibold text-foreground">
            {entryContext.heading}
          </Text>
          <Text className="mt-1 text-xs leading-5 text-muted">
            {entryContext.description}
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {entryContext.facts.map((fact) => (
              <View
                key={fact.label}
                className="rounded-md px-2 py-1"
                style={{ backgroundColor: colors.secondary }}
              >
                <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {fact.label}
                </Text>
                <Text className="mt-0.5 text-xs font-semibold text-foreground">
                  {fact.value}
                </Text>
              </View>
            ))}
          </View>
          <View
            className="mt-3 pt-3"
            style={{ borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Detail sections
            </Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {entryContext.sections.map((section) => (
                <View
                  key={section.key}
                  className="rounded-md border px-2 py-1"
                  style={{ borderColor: colors.border, backgroundColor: colors.background }}
                >
                  <Text className="text-[10px] font-medium text-muted">
                    {section.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          {entryContext.dependencySummary ? (
            <View
              className="mt-3 pt-3"
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
            <Pressable
              onPress={() => dispatchMutation.mutate({ workItemId: item.id })}
              disabled={dispatchMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={`${entryAction.label} on ${item.identifier}`}
              className="mt-3 rounded-md px-3 py-2 active:opacity-70"
              style={{
                backgroundColor: colors.primary,
                opacity: dispatchMutation.isPending ? 0.65 : 1,
              }}
            >
              <Text className="text-center text-xs font-semibold text-background">
                {dispatchMutation.isPending ? "Starting..." : entryAction.label}
              </Text>
            </Pressable>
          ) : entryAction.kind === "live-session" ? (
            <Pressable
              onPress={() => onOpenSession?.(entryAction.sessionId)}
              accessibilityRole="button"
              accessibilityLabel={`Open live session for ${item.identifier}`}
              className="mt-3 rounded-md px-3 py-2 active:opacity-70"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-center text-xs font-semibold text-background">
                {entryAction.label}
              </Text>
            </Pressable>
          ) : null}
          {showValidationState ? (
            <ValidationStateCard validationState={validationState} />
          ) : null}
        </View>

        {entryView === "outcome" ? (
          <OutcomeReadableOutputCard
            workItemId={item.id}
            onOpenSession={onOpenSession}
          />
        ) : null}

        {entryView === "queue" ? (
          <LinkedExecutionRunsCard
            workItemId={item.id}
            workspaceId={(item as { workspaceId?: string | null }).workspaceId ?? null}
            onOpenSession={onOpenSession}
          />
        ) : null}

        {/* Description */}
        {item.description ? (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Description
            </Text>
            <Text className="text-sm leading-5 text-foreground">
              {item.description}
            </Text>
          </View>
        ) : null}

        {/* Artifacts */}
        {item.currentArtifacts && item.currentArtifacts.length > 0 && (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Artifacts
            </Text>
            {item.currentArtifacts.map((artifact) => (
              <View
                key={artifact.id}
                className="mb-2 rounded-lg px-3 py-2"
                style={{ backgroundColor: colors.card }}
              >
                <Text className="text-sm font-medium text-foreground">
                  {artifact.title ?? artifact.artifactRole}
                </Text>
                <Text className="text-xs text-muted">
                  {artifact.artifactType}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Planning sessions */}
        {item.sessions && item.sessions.length > 0 && (
          <View className="mb-6">
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Planning Sessions
            </Text>
            {item.sessions.map((session) => (
              <Pressable
                key={session.id}
                onPress={() => onOpenSession?.(session.id)}
                className="mb-2 flex-row items-center justify-between rounded-lg px-3 py-3 active:opacity-70"
                style={{ backgroundColor: colors.card, minHeight: 44 }}
              >
                <View>
                  <Text className="text-sm font-medium text-foreground">
                    {session.planningSessionType ?? "Session"}
                  </Text>
                  <Text className="text-xs text-muted">
                    {session.status}
                  </Text>
                </View>
                <Text className="text-xs font-medium text-primary">
                  {session.status === "running" || session.status === "idle" ? "Resume" : "View"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
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
      className="mt-3 rounded-md border px-3 py-3"
      style={{
        borderColor: `${toneColor}66`,
        backgroundColor: `${toneColor}18`,
      }}
    >
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        Validation state
      </Text>
      <Text className="mt-1 text-xs font-semibold text-foreground">
        {validationState.label}
      </Text>
      <Text className="mt-1 text-xs leading-5" style={{ color: toneColor }}>
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
    <View className="mb-3">
      <Text className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </Text>
      {items.length === 0 ? (
        <View
          className="rounded-md border px-2 py-2"
          style={{ borderColor: colors.border }}
        >
          <Text className="text-[10px] text-muted">{empty}</Text>
        </View>
      ) : (
        <View className="gap-2">
          {items.map((item) => (
            <View
              key={item.id}
              className="rounded-md border px-2 py-2"
              style={{ borderColor: colors.border, backgroundColor: colors.background }}
            >
              <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
                {item.identifier} · {item.title}
              </Text>
              <Text className="mt-0.5 text-[10px] text-muted">
                {item.statusLabel}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
