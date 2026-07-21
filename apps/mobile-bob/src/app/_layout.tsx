import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Stack, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { queryClient } from "~/utils/api";
import { Providers } from "../providers";
import { TabletSidebar } from "~/components/tablet/TabletSidebar";
import { AgentThreadView } from "~/components/tablet/AgentThreadView";
import { WorkItemPane } from "~/components/tablet/WorkItemPane";
import { PlanningPane } from "~/components/tablet/PlanningPane";
import { InspectorPanel } from "~/components/tablet/InspectorPanel";
import { TasksDashboard } from "~/components/tablet/TasksDashboard";
import { TabletPlanningDashboard } from "~/components/tablet/TabletPlanningDashboard";
import { TabletProviderPane } from "~/components/tablet/TabletProviderPane";
import { TabletProjectPane } from "~/components/tablet/TabletProjectPane";
import { TabletProjectsDashboardPane } from "~/components/tablet/TabletProjectsDashboardPane";
import { TabletSettingsPane } from "~/components/tablet/TabletSettingsPane";
import { TaskLaneTablePane } from "~/components/tablet/TaskLaneTablePane";
import type {
  TabletPlanningDashboardNavigationAction,
  TabletPlanningSummaryTarget,
} from "~/features/tablet/planning-dashboard";
import { useGateway } from "~/hooks/use-gateway";
import { getLiveDashboardSessions } from "~/hooks/gateway-sessions";
import { useSelectedWorkspace } from "~/hooks/use-selected-workspace";
import { useTabletShortcuts } from "~/hooks/use-keyboard-shortcuts";
import { extractFileReferences } from "~/lib/file-references";
import {
  getTabletGlobalActionPosition,
  getTabletShellPadding,
  getTabletSidebarWidth,
} from "~/lib/tablet-layout";
import {
  getMobilePlanningFilterHref,
  getTabletDashboardHref,
  getTabletPlanningSessionHref,
  getTabletProjectHref,
  getTabletProjectsHref,
  getTabletProviderHref,
  getTabletSettingsHref,
  getTabletSessionHref,
  getTabletTaskLaneHref,
  getTabletWorkItemHref,
} from "~/features/tablet/navigation";
import {
  getPlanningPaneSession,
  getRecentOutcomeTarget,
  getExecutionSessionShellState,
  getShellSelectionIntent,
  getShellStateForPath,
  getShellGlobalActions,
  selectLeftRailTarget,
  switchShellMode,
} from "~/features/tablet/shell";
import type {
  TabletLeftRailTab,
  TabletShellMode,
  TabletShellTarget,
} from "~/features/tablet/shell";
import type { ProviderKey, TaskLaneKey } from "~/features/tablet/dashboard";
import type { MobileWorkItemEntryView } from "~/features/tablet/work-item-entry";
import { colors } from "~/lib/colors";

import "../styles.css";

const isTablet = Platform.OS === "ios" && Platform.isPad;

const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: "#141310" },
  animation: "fade" as const,
};

function firstRouteParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function PhoneLayout() {
  return <Stack screenOptions={stackScreenOptions} />;
}

function MainPane({
  gateway,
  target,
  onOpenProvider,
  onOpenLane,
  onOpenWorkItem,
  onSelectProject,
  selectedWorkItemView,
  onOpenSession,
  onOpenPlanningSession,
  onOpenPlanningSummaryTarget,
  onOpenPlanningNavigationAction,
  planningComposerOpen,
  onPlanningComposerOpenChange,
  onShowArtifact,
  onOpenInspector,
}: {
  gateway: ReturnType<typeof useGateway>;
  target: TabletShellTarget;
  onOpenProvider: (provider: ProviderKey) => void;
  onOpenLane: (lane: TaskLaneKey) => void;
  onOpenWorkItem: (workItemId: string, view?: MobileWorkItemEntryView) => void;
  onSelectProject: (projectId: string) => void;
  selectedWorkItemView: MobileWorkItemEntryView;
  onOpenSession: (sessionId: string) => void;
  onOpenPlanningSession: (sessionId: string) => void;
  onOpenPlanningSummaryTarget: (target: TabletPlanningSummaryTarget) => void;
  onOpenPlanningNavigationAction: (action: TabletPlanningDashboardNavigationAction) => void;
  planningComposerOpen: boolean;
  onPlanningComposerOpenChange: (open: boolean) => void;
  onShowArtifact: (content: string) => void;
  onOpenInspector: () => void;
}) {
  if (target.type === "planning-session") {
    const planningSession = getPlanningPaneSession(gateway.sessions, target.sessionId);

    return (
      <PlanningPane
        sessionId={planningSession.sessionId}
        sessionStatus={planningSession.status}
        sessionType={planningSession.sessionType}
        workItemTitle={planningSession.title}
        events={gateway.selectedSessionEvents}
        onSendInput={gateway.sendInput}
        onStopSession={gateway.stopSession}
        onShowArtifact={onShowArtifact}
      />
    );
  }

  if (target.type === "tasks-dashboard") {
    return (
      <TasksDashboard
        sessions={getLiveDashboardSessions(gateway.sessions)}
        onOpenProvider={onOpenProvider}
        onOpenLane={onOpenLane}
        onOpenWorkItem={onOpenWorkItem}
        onOpenSession={onOpenSession}
      />
    );
  }

  if (target.type === "task-lane") {
    return (
      <TaskLaneTablePane
        lane={target.lane}
        onOpenWorkItem={onOpenWorkItem}
      />
    );
  }

  if (target.type === "planning-dashboard") {
    return (
      <TabletPlanningDashboard
        sessions={gateway.sessions}
        onOpenPlanningSession={onOpenPlanningSession}
        onOpenSummaryTarget={onOpenPlanningSummaryTarget}
        onOpenNavigationAction={onOpenPlanningNavigationAction}
        composerOpen={planningComposerOpen}
        onComposerOpenChange={onPlanningComposerOpenChange}
        isEmbeddedInShell
      />
    );
  }

  if (target.type === "projects-dashboard") {
    return <TabletProjectsDashboardPane onSelectProject={onSelectProject} />;
  }

  if (target.type === "project") {
    return (
      <TabletProjectPane
        projectId={target.projectId}
        onOpenWorkItem={onOpenWorkItem}
      />
    );
  }

  if (target.type === "provider") {
    return (
      <TabletProviderPane
        provider={target.provider}
        onOpenWorkItem={onOpenWorkItem}
        onOpenSession={onOpenSession}
      />
    );
  }

  if (target.type === "settings") {
    return <TabletSettingsPane onOpenProvider={onOpenProvider} />;
  }

  if (gateway.activePlanningSessionId && gateway.selectedSessionId) {
    const planningSession = getPlanningPaneSession(
      gateway.sessions,
      gateway.activePlanningSessionId,
    );

    return (
      <PlanningPane
        sessionId={planningSession.sessionId}
        sessionStatus={planningSession.status}
        sessionType={planningSession.sessionType}
        workItemTitle={planningSession.title}
        events={gateway.selectedSessionEvents}
        onSendInput={gateway.sendInput}
        onStopSession={gateway.stopSession}
        onShowArtifact={onShowArtifact}
      />
    );
  }

  if (gateway.selectedSessionId) {
    return (
      <AgentThreadView
        sessionId={gateway.selectedSessionId}
        events={gateway.selectedSessionEvents}
        onSendInput={gateway.sendInput}
        onStopSession={gateway.stopSession}
      />
    );
  }

  if (gateway.selectedWorkItemId) {
    return (
      <WorkItemPane
        workItemId={gateway.selectedWorkItemId}
        entryView={selectedWorkItemView}
        onOpenSession={onOpenSession}
        onOpenInspector={onOpenInspector}
      />
    );
  }

  return <Stack screenOptions={stackScreenOptions} />;
}

function TabletLayout() {
  const gateway = useGateway();
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useLocalSearchParams<{
    lane?: string;
    provider?: string;
    projectId?: string;
    sessionId?: string;
    view?: string;
    workItemId?: string;
  }>();
  const routeShellParams = useMemo(
    () => ({
      lane: firstRouteParam(routeParams.lane),
      provider: firstRouteParam(routeParams.provider),
      projectId: firstRouteParam(routeParams.projectId),
      sessionId: firstRouteParam(routeParams.sessionId),
      view: firstRouteParam(routeParams.view),
      workItemId: firstRouteParam(routeParams.workItemId),
    }),
    [
      routeParams.lane,
      routeParams.provider,
      routeParams.projectId,
      routeParams.sessionId,
      routeParams.view,
      routeParams.workItemId,
    ],
  );
  const { selectedWorkspaceId, workspace } = useSelectedWorkspace();
  const { width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [inspectorArtifact, setInspectorArtifact] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedWorkItemView, setSelectedWorkItemView] =
    useState<MobileWorkItemEntryView>("planning");
  const [planningComposerOpen, setPlanningComposerOpen] = useState(false);
  const [shell, setShell] = useState(() => switchShellMode("tasks"));
  const currentShellModeRef = useRef(shell.mode);
  const sidebarWidth = getTabletSidebarWidth(width);

  const fileReferences = useMemo(
    () => extractFileReferences(gateway.selectedSessionEvents),
    [gateway.selectedSessionEvents],
  );
  const shellPadding = useMemo(
    () => getTabletShellPadding(safeAreaInsets),
    [safeAreaInsets],
  );
  const globalActionPosition = useMemo(
    () => getTabletGlobalActionPosition(safeAreaInsets),
    [safeAreaInsets],
  );
  const globalActions = useMemo(
    () => getShellGlobalActions(workspace?.name),
    [workspace?.name],
  );
  const { openPlanningSession, selectSession, selectWorkItem } = gateway;

  useEffect(() => {
    currentShellModeRef.current = shell.mode;
  }, [shell.mode]);

  const handleShowArtifact = useCallback((content: string) => {
    setInspectorArtifact(content);
    setInspectorVisible(true);
  }, []);

  const handleOpenInspector = useCallback(() => {
    setInspectorVisible(true);
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFilePath((prev) => (prev === path ? null : path));
  }, []);

  const clearDetailState = useCallback(() => {
    gateway.selectSession(null);
    gateway.selectWorkItem(null);
    setInspectorVisible(false);
    setInspectorArtifact(null);
    setSelectedFilePath(null);
    setSelectedWorkItemView("planning");
    setPlanningComposerOpen(false);
  }, [gateway]);

  useEffect(() => {
    const nextShell = getShellStateForPath(
      pathname,
      routeShellParams,
      currentShellModeRef.current,
    );
    const selection = getShellSelectionIntent(nextShell);

    setShell((current) =>
      JSON.stringify(current) === JSON.stringify(nextShell) ? current : nextShell,
    );
    setSelectedWorkItemView(selection.workItemView);

    if (selection.selectedWorkItemId) {
      selectSession(null);
      selectWorkItem(selection.selectedWorkItemId);
      return;
    }

    if (selection.selectedSessionId) {
      selectWorkItem(null);
      selectSession(selection.selectedSessionId);
      return;
    }

    if (selection.planningSessionId) {
      selectWorkItem(null);
      openPlanningSession(selection.planningSessionId);
      return;
    }

    selectSession(null);
    selectWorkItem(null);
  }, [
    openPlanningSession,
    pathname,
    routeShellParams,
    selectSession,
    selectWorkItem,
  ]);

  const handleOpenSettings = useCallback(() => {
    clearDetailState();
    setShell((prev) => ({
      ...prev,
      target: { type: "settings" },
    }));
    router.replace(getTabletSettingsHref(selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleModeChange = useCallback((mode: TabletShellMode) => {
    clearDetailState();
    setShell(switchShellMode(mode));
    router.replace(getTabletDashboardHref(mode, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleLeftTabChange = useCallback((leftTab: TabletLeftRailTab) => {
    clearDetailState();
    setShell((prev) => ({
      ...prev,
      leftTab,
      target: selectLeftRailTarget(prev.mode, leftTab),
    }));
    if (leftTab === "projects") {
      router.replace(getTabletProjectsHref(selectedWorkspaceId) as never);
      return;
    }
    router.replace(getTabletDashboardHref(shell.mode, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId, shell.mode]);

  const handleSelectSession = useCallback((sessionId: string) => {
    const session = gateway.sessions.find((candidate) => candidate.sessionId === sessionId);
    const outcomeTarget = session ? getRecentOutcomeTarget(session) : null;
    if (outcomeTarget?.target.type === "work-item") {
      setShell({
        mode: "tasks",
        leftTab: outcomeTarget.leftTab,
        target: outcomeTarget.target,
      });
      setSelectedWorkItemView(outcomeTarget.entryView ?? "outcome");
      gateway.selectWorkItem(outcomeTarget.target.workItemId);
      router.replace(
        getTabletWorkItemHref(
          outcomeTarget.target.workItemId,
          outcomeTarget.entryView ?? "outcome",
          selectedWorkspaceId,
        ) as never,
      );
      return;
    }

    setShell(getExecutionSessionShellState(sessionId));
    gateway.selectSession(sessionId);
    router.replace(getTabletSessionHref(sessionId, selectedWorkspaceId) as never);
  }, [gateway, router, selectedWorkspaceId]);

  const handleOpenSession = useCallback((sessionId: string) => {
    setShell(getExecutionSessionShellState(sessionId));
    gateway.selectSession(sessionId);
    router.replace(getTabletSessionHref(sessionId, selectedWorkspaceId) as never);
  }, [gateway, router, selectedWorkspaceId]);

  const handleOpenPlanningSession = useCallback((sessionId: string) => {
    gateway.selectWorkItem(null);
    setShell({
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-session", sessionId },
    });
    gateway.openPlanningSession(sessionId);
    router.replace(getTabletPlanningSessionHref(sessionId, selectedWorkspaceId) as never);
  }, [gateway, router, selectedWorkspaceId]);

  const handleOpenPlanningSummaryTarget = useCallback((target: TabletPlanningSummaryTarget) => {
    clearDetailState();
    if (target.type === "projects-dashboard") {
      setShell({
        mode: "planning",
        leftTab: "projects",
        target: { type: "projects-dashboard" },
      });
      router.replace(getTabletProjectsHref(selectedWorkspaceId, target.filter) as never);
      return;
    }

    setShell({
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-dashboard" },
    });
    router.replace(getMobilePlanningFilterHref(target.filter, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleOpenPlanningNavigationAction = useCallback((
    action: TabletPlanningDashboardNavigationAction,
  ) => {
    clearDetailState();
    if (action.key === "projects") {
      setShell({
        mode: "planning",
        leftTab: "projects",
        target: { type: "projects-dashboard" },
      });
      router.replace(getTabletProjectsHref(selectedWorkspaceId) as never);
      return;
    }

    setShell({
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-dashboard" },
    });
    router.replace(getTabletDashboardHref("planning", selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleSelectWorkItem = useCallback((
    workItemId: string,
    view: MobileWorkItemEntryView = "queue",
  ) => {
    setShell({
      mode: "tasks",
      leftTab: view === "outcome" ? "recent-outcomes" : "priority-queue",
      target: { type: "work-item", workItemId, view },
    });
    setSelectedWorkItemView(view);
    gateway.selectWorkItem(workItemId);
    router.replace(getTabletWorkItemHref(workItemId, view, selectedWorkspaceId) as never);
  }, [gateway, router, selectedWorkspaceId]);

  const handleSelectProject = useCallback((projectId: string) => {
    clearDetailState();
    setShell({
      mode: "planning",
      leftTab: "projects",
      target: { type: "project", projectId },
    });
    router.replace(getTabletProjectHref(projectId, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleOpenProvider = useCallback((provider: ProviderKey) => {
    clearDetailState();
    setShell({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "provider", provider },
    });
    router.replace(getTabletProviderHref(provider, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  const handleOpenTaskLane = useCallback((lane: TaskLaneKey) => {
    clearDetailState();
    setShell({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "task-lane", lane },
    });
    router.replace(getTabletTaskLaneHref(lane, selectedWorkspaceId) as never);
  }, [clearDetailState, router, selectedWorkspaceId]);

  useTabletShortcuts({
    onFocusSidebar: () => { /* TODO: focus sidebar search when added */ },
    onFocusMain: () => { /* TODO: focus main pane input */ },
    onToggleInspector: () => setInspectorVisible((v) => !v),
  });

  return (
    <View
      testID="tablet-shell"
      className="flex-1"
      style={{
        backgroundColor: colors.background,
        paddingTop: shellPadding.top,
        paddingRight: shellPadding.right,
        paddingBottom: shellPadding.bottom,
        paddingLeft: shellPadding.left,
      }}
    >
      <View className="flex-1 flex-row">
        <View
          testID="tablet-sidebar"
          style={{
            width: sidebarWidth,
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          <TabletSidebar
            mode={shell.mode}
            leftTab={shell.leftTab}
            sessions={gateway.sessions}
            connectionState={gateway.connectionState}
            selectedSessionId={gateway.selectedSessionId}
            selectedWorkItemId={gateway.selectedWorkItemId}
            onModeChange={handleModeChange}
            onLeftTabChange={handleLeftTabChange}
            onSelectSession={handleSelectSession}
            onSelectWorkItem={handleSelectWorkItem}
            onOpenPlanningSession={handleOpenPlanningSession}
            onSelectProject={handleSelectProject}
            onOpenSession={handleOpenSession}
            onRefresh={gateway.refresh}
          />
        </View>
        <View testID="tablet-main" className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <MainPane
              gateway={gateway}
              target={shell.target}
              onOpenProvider={handleOpenProvider}
              onOpenLane={handleOpenTaskLane}
              onOpenWorkItem={handleSelectWorkItem}
              onSelectProject={handleSelectProject}
              selectedWorkItemView={selectedWorkItemView}
              onOpenSession={handleOpenSession}
              onOpenPlanningSession={handleOpenPlanningSession}
              onOpenPlanningSummaryTarget={handleOpenPlanningSummaryTarget}
              onOpenPlanningNavigationAction={handleOpenPlanningNavigationAction}
              planningComposerOpen={planningComposerOpen}
              onPlanningComposerOpenChange={setPlanningComposerOpen}
              onShowArtifact={handleShowArtifact}
              onOpenInspector={handleOpenInspector}
            />
            <InspectorPanel
              visible={inspectorVisible}
              onClose={() => setInspectorVisible(false)}
              artifactContent={inspectorArtifact}
              fileReferences={fileReferences}
              selectedFilePath={selectedFilePath}
              onSelectFile={handleSelectFile}
              workItemId={gateway.selectedWorkItemId}
            />
          </View>
        </View>
      </View>

      <View
        className="absolute flex-row gap-2"
        style={{
          zIndex: 20,
          top: globalActionPosition.top,
          right: globalActionPosition.right,
        }}
      >
        {globalActions.map((action) => (
          <Pressable
            key={action.key}
            onPress={handleOpenSettings}
            accessibilityRole="button"
            accessibilityLabel={`Open settings for ${action.detailLabel}`}
            className="rounded-md px-3 py-1.5 active:opacity-70"
            style={{
              backgroundColor: colors.secondary,
              minHeight: 36,
              justifyContent: "center",
            }}
          >
            <Text className="text-xs font-semibold text-foreground">
              {action.label}
            </Text>
            <Text className="text-[10px] font-medium text-muted" numberOfLines={1}>
              {action.detailLabel}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        {isTablet ? <TabletLayout /> : <PhoneLayout />}
        <StatusBar style="light" />
      </Providers>
    </QueryClientProvider>
  );
}
