import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";

import type { GatewaySession } from "~/hooks/use-gateway";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { colors } from "~/lib/colors";
import {
  getMobileShellGlobalActions,
  getMobileShellModeActions,
} from "~/features/tablet/navigation";
import {
  buildMobilePlanningSessionRequest,
} from "~/features/planning/mobile-actions";
import { getMobileProjectQueryRefreshOptions } from "~/features/planning/project-status";
import {
  buildTabletPlanningDashboardSessionRows,
  buildTabletPlanningSessionRequestInput,
  buildPlanningDashboardModel,
  filterTabletPlanningDashboardSessions,
  getPlanningDashboardComposerAction,
  getPlanningDashboardNavigationActions,
  getPlanningLiveRailPresentation,
  getTabletPlanningDashboardHeaderModel,
  normalizeTabletPlanningDashboardFilter,
  shouldShowPlanningDashboardModeActions,
  shouldShowPlanningDashboardNavigationActions,
} from "~/features/tablet/planning-dashboard";
import type {
  TabletPlanningDashboardNavigationAction,
  TabletPlanningDashboardSessionRow,
  TabletPlanningDashboardSummaryTone,
  TabletPlanningSummaryTarget,
  TabletPlanningProject,
} from "~/features/tablet/planning-dashboard";
import type { TabletShellMode } from "~/features/tablet/shell";
import { trpc } from "~/utils/api";

const SUMMARY_TONE_COLORS: Record<TabletPlanningDashboardSummaryTone, string> = {
  default: colors.muted,
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
};

const SESSION_STATUS_TONE_COLORS: Record<TabletPlanningDashboardSessionRow["statusTone"], string> = {
  default: colors.muted,
  warning: colors.warning,
  danger: colors.danger,
  success: colors.success,
};

function PlanningSessionRow({
  row,
  onPress,
}: {
  row: TabletPlanningDashboardSessionRow;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open planning session ${row.title}, ${row.statusLabel}, updated ${row.lastUpdatedLabel}`}
      className="rounded-lg border px-3 py-2 active:opacity-80"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
            {row.title}
          </Text>
          <Text className="mt-1 text-xs text-muted" numberOfLines={1}>
            {row.outputLabel} · {row.lastUpdatedLabel}
          </Text>
        </View>
        <Text
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          numberOfLines={1}
          style={{
            color: SESSION_STATUS_TONE_COLORS[row.statusTone],
            backgroundColor: `${SESSION_STATUS_TONE_COLORS[row.statusTone]}20`,
          }}
        >
          {row.statusLabel}
        </Text>
      </View>
    </Pressable>
  );
}

function getCreatedSessionId(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }

  throw new Error("Planning session did not return a session id");
}

export function TabletPlanningDashboard({
  sessions,
  onOpenPlanningSession,
  onOpenSummaryTarget,
  onOpenNavigationAction,
  onOpenMode,
  onOpenSettings,
  composerOpen,
  onComposerOpenChange,
  isEmbeddedInShell = false,
}: {
  sessions: GatewaySession[];
  onOpenPlanningSession: (sessionId: string) => void;
  onOpenSummaryTarget?: (target: TabletPlanningSummaryTarget) => void;
  onOpenNavigationAction?: (action: TabletPlanningDashboardNavigationAction) => void;
  onOpenMode?: (mode: TabletShellMode) => void;
  onOpenSettings?: () => void;
  composerOpen?: boolean;
  onComposerOpenChange?: (open: boolean) => void;
  isEmbeddedInShell?: boolean;
}) {
  const { width } = useWindowDimensions();
  const searchParams = useLocalSearchParams<{ filter?: string }>();
  const queryClient = useQueryClient();
  const { workspace } = useSelectedWorkspace();
  const [localComposerOpen, setLocalComposerOpen] = useState(false);
  const [liveRailOpen, setLiveRailOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isComposerOpen = composerOpen ?? localComposerOpen;
  const setComposerOpen = onComposerOpenChange ?? setLocalComposerOpen;
  const composerAction = getPlanningDashboardComposerAction(isComposerOpen);
  const navigationActions = useMemo(() => getPlanningDashboardNavigationActions(), []);
  const projectsQuery = useQuery(
    trpc.project.list.queryOptions(
      { workspaceId: workspace?.id ?? "" },
      {
        enabled: Boolean(workspace?.id),
        ...getMobileProjectQueryRefreshOptions(),
      },
    ),
  );
  const projects = useMemo(
    () =>
      (Array.isArray(projectsQuery.data)
        ? projectsQuery.data
        : []) as TabletPlanningProject[],
    [projectsQuery.data],
  );
  const model = useMemo(
    () => buildPlanningDashboardModel({ sessions, projects }),
    [projects, sessions],
  );
  const rawFilterParam: unknown = searchParams.filter;
  const sessionFilter = normalizeTabletPlanningDashboardFilter(
    Array.isArray(rawFilterParam)
      ? (rawFilterParam[0] as string | undefined)
      : (rawFilterParam as string | undefined),
  );
  const visibleRecentSessions = useMemo(
    () =>
      sessionFilter
        ? filterTabletPlanningDashboardSessions(sessions, sessionFilter)
        : model.recentSessions,
    [model.recentSessions, sessionFilter, sessions],
  );
  const visibleRecentSessionRows = useMemo(
    () => buildTabletPlanningDashboardSessionRows(visibleRecentSessions),
    [visibleRecentSessions],
  );
  const primaryProject = projects[0]?.project ?? null;
  const createPlanningSessionMutation = useMutation(
    trpc.planSession.create.mutationOptions(),
  );
  const startPlanningSessionMutation = useMutation(
    trpc.planSession.start.mutationOptions(),
  );
  const isStarting =
    createPlanningSessionMutation.isPending ||
    startPlanningSessionMutation.isPending;
  const liveRailPresentation = getPlanningLiveRailPresentation(width);
  const showInlineActiveRail = liveRailPresentation === "rail";
  const showCompactNavigationActions = shouldShowPlanningDashboardNavigationActions({
    hasModeSwitch: Boolean(onOpenMode),
    isEmbeddedInShell,
    width,
  });
  const header = getTabletPlanningDashboardHeaderModel();
  const showModeActions = shouldShowPlanningDashboardModeActions({
    hasModeSwitch: Boolean(onOpenMode),
    isEmbeddedInShell,
  });
  const modeActions = showModeActions
    ? getMobileShellModeActions("planning", workspace?.id)
    : [];
  const globalActions = onOpenSettings
    ? getMobileShellGlobalActions(workspace?.id)
    : [];

  const startPlanning = async () => {
    const requestInput = buildTabletPlanningSessionRequestInput({
      workspaceId: workspace?.id ?? null,
      projects,
      goal,
    });
    const request = requestInput
      ? buildMobilePlanningSessionRequest(requestInput)
      : null;

    if (!request) return;

    setError(null);
    try {
      const created: unknown = await createPlanningSessionMutation.mutateAsync(
        request.createInput,
      );
      const sessionId = getCreatedSessionId(created);
      await startPlanningSessionMutation.mutateAsync(
        request.buildStartInput(sessionId),
      );
      setGoal("");
      setComposerOpen(false);
      await queryClient.invalidateQueries({
        queryKey: trpc.session.list.queryKey({ limit: 50 }),
      });
      onOpenPlanningSession(sessionId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to start planning session");
    }
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
    >
      <View className={showInlineActiveRail ? "flex-row gap-4" : "gap-4"}>
        <View className="min-w-0 flex-1">
          {modeActions.length > 0 ? (
            <View className="mb-4 flex-row gap-2">
              {modeActions.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={() => onOpenMode?.(action.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: action.isActive }}
                  accessibilityLabel={`Open ${action.label}`}
                  className="rounded-md px-3 py-2 active:opacity-80"
                  style={{
                    backgroundColor: action.isActive ? colors.primary : colors.secondary,
                  }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: action.isActive ? colors.background : colors.foreground }}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="flex-row items-start justify-between gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-3xl font-semibold tracking-tight text-foreground">
                {header.title}
              </Text>
            </View>
            <View className="flex-row gap-2">
              {globalActions.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={onOpenSettings}
                  accessibilityRole="button"
                  accessibilityLabel={action.accessibilityLabel}
                  className="rounded-md px-3 py-2 active:opacity-80"
                  style={{ backgroundColor: colors.secondary }}
                >
                  <Text className="text-xs font-semibold text-foreground">
                    {action.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setComposerOpen(composerAction.nextOpen)}
                accessibilityRole="button"
                accessibilityLabel={
                  composerAction.nextOpen
                    ? "Start planning session"
                    : "Hide planning session composer"
                }
                className="rounded-md px-3 py-2 active:opacity-80"
                style={{
                  backgroundColor: composerAction.nextOpen ? colors.primary : colors.secondary,
                }}
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: composerAction.nextOpen ? colors.background : colors.foreground }}
                >
                  {composerAction.label}
                </Text>
              </Pressable>
            </View>
          </View>

          {isComposerOpen ? (
            <View
              className="mt-4 rounded-lg border p-4"
              style={{ borderColor: colors.border, backgroundColor: colors.card }}
            >
              <Text className="mb-3 text-sm font-semibold text-foreground">
                New planning session
              </Text>
              <TextInput
                value={goal}
                onChangeText={setGoal}
                multiline
                placeholder="What should Bob plan?"
                placeholderTextColor={colors.muted2}
                className="min-h-24 rounded-lg border px-3 py-3 text-foreground"
                style={{ borderColor: colors.border }}
              />
              <Pressable
                onPress={() => void startPlanning()}
                disabled={!goal.trim() || !primaryProject?.name || isStarting}
                className="mt-3 rounded-md px-4 py-2 active:opacity-80"
                style={{
                  backgroundColor: colors.primary,
                  opacity: !goal.trim() || !primaryProject?.name || isStarting ? 0.55 : 1,
                }}
              >
                <Text className="text-center text-sm font-semibold text-background">
                  {isStarting ? "Starting..." : "Start planning"}
                </Text>
              </Pressable>
              {error ? (
                <Text className="mt-2 text-sm text-danger">{error}</Text>
              ) : null}
            </View>
          ) : null}

          {showCompactNavigationActions ? (
            <View className="mt-4 flex-row gap-2">
              {navigationActions.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={() => onOpenNavigationAction?.(action)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${action.label}`}
                  className="rounded-md border px-3 py-2 active:opacity-80"
                  style={{
                    borderColor: colors.border,
                    backgroundColor:
                      action.key === "recent-sessions" ? colors.secondary : colors.card,
                  }}
                >
                  <Text className="text-xs font-semibold text-foreground">
                    {action.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setLiveRailOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel={liveRailOpen ? "Hide active sessions" : "Show active sessions"}
                className="rounded-md border px-3 py-2 active:opacity-80"
                style={{
                  borderColor: colors.border,
                  backgroundColor: liveRailOpen ? colors.secondary : colors.card,
                }}
              >
                <Text className="text-xs font-semibold text-foreground">
                  Active Sessions {model.activeSessions.length}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {liveRailPresentation === "sheet" && liveRailOpen ? (
            <View className="mt-4">
              <PlanningActiveSessionsRail
                sessions={model.activeSessions}
                onOpenPlanningSession={onOpenPlanningSession}
              />
            </View>
          ) : null}

          <View className="mt-6 flex-row flex-wrap gap-3">
            {model.summaryCards.map((card) => (
              <Pressable
                key={card.key}
                onPress={() => onOpenSummaryTarget?.(card.target)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${card.title}`}
                className="rounded-lg border p-4"
                style={{
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  minWidth: 148,
                  flexGrow: 1,
                }}
              >
                <Text className="text-xs uppercase text-muted" numberOfLines={1}>
                  {card.title}
                </Text>
                <Text
                  className="mt-2 text-2xl font-semibold"
                  style={{ color: SUMMARY_TONE_COLORS[card.tone] }}
                >
                  {projectsQuery.isLoading ? "..." : card.count}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-6">
            <Text className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              Recent Sessions
              {sessionFilter ? ` · ${formatPlanningSessionFilterLabel(sessionFilter)}` : ""}
            </Text>
            {visibleRecentSessionRows.length === 0 ? (
              <View
                className="rounded-lg border p-4"
                style={{ borderColor: colors.border, backgroundColor: colors.card }}
              >
                <Text className="text-sm text-muted">
                  {sessionFilter ? "No planning sessions match this filter." : "No completed planning sessions yet."}
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {visibleRecentSessionRows.map((row) => (
                  <PlanningSessionRow
                    key={row.sessionId}
                    row={row}
                    onPress={() => onOpenPlanningSession(row.sessionId)}
                  />
                ))}
              </View>
            )}
          </View>
        </View>

        {showInlineActiveRail ? (
          <View style={{ width: 280 }}>
            <PlanningActiveSessionsRail
              sessions={model.activeSessions}
              onOpenPlanningSession={onOpenPlanningSession}
            />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function formatPlanningSessionFilterLabel(filter: string): string {
  return filter === "awaiting-input" ? "Needs Input" : "Drafts";
}

function PlanningActiveSessionsRail({
  sessions,
  onOpenPlanningSession,
}: {
  sessions: GatewaySession[];
  onOpenPlanningSession: (sessionId: string) => void;
}) {
  const rows = buildTabletPlanningDashboardSessionRows(sessions);

  return (
    <View
      testID="planning-active-sessions-rail"
      collapsable={false}
      accessible
      accessibilityLabel="Planning active sessions rail"
      className="rounded-lg border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.card }}
    >
      <View className="mb-3 flex-row items-center justify-between">
        <Text className="text-sm font-semibold uppercase tracking-wider text-muted">
          Active Sessions
        </Text>
        <Text className="text-xs font-semibold text-foreground">
          {rows.length}
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text className="text-sm text-muted">
          No planning sessions are currently running.
        </Text>
      ) : (
        <View className="gap-2">
          {rows.map((row) => (
            <PlanningSessionRow
              key={row.sessionId}
              row={row}
              onPress={() => onOpenPlanningSession(row.sessionId)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
