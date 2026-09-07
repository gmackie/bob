import type { Href } from "expo-router";

import type {
  ProviderKey,
  RunningNowWorkItemTarget,
  TaskLaneKey,
} from "./dashboard";
import type { TabletShellMode, TasksLeftRailTab } from "./shell";
import type { MobileWorkItemEntryView } from "./work-item-entry";
import { appendWorkspaceParam, getPlanningHref } from "../planning/navigation";

export interface MobileShellModeAction {
  key: TabletShellMode;
  label: "OODA" | "Planning" | "Tasks";
  href: Extract<Href, string>;
  isActive: boolean;
}

export interface MobileShellGlobalAction {
  key: "settings";
  label: "Settings";
  href: Extract<Href, string>;
  accessibilityLabel: "Open settings";
}

export type MobileDetailBackSource =
  | { source: "execution-session"; workspaceId?: string | null }
  | { source: "planning-session"; workspaceId?: string | null }
  | {
      source: "work-item";
      view: MobileWorkItemEntryView;
      workspaceId?: string | null;
    };

export interface MobileDetailBackAction {
  label: "Planning" | "Tasks" | "Priority Queue" | "Recent Outcomes";
  accessibilityLabel: string;
  href: Extract<Href, string>;
}

export function getTabletDashboardHref(
  mode: TabletShellMode = "tasks",
  workspaceId?: string | null,
) {
  if (mode === "ooda") {
    return appendWorkspaceParam("/chat", workspaceId);
  }

  return appendWorkspaceParam(
    mode === "planning" ? getPlanningHref() : "/tasks",
    workspaceId,
  );
}

export function getTabletDashboardSelectionReset(): {
  selectedSessionId: null;
  selectedWorkItemId: null;
} {
  return {
    selectedSessionId: null,
    selectedWorkItemId: null,
  };
}

export function getMobileTaskTabHref(
  tab: TasksLeftRailTab,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    tab === "recent-outcomes" ? "/tasks/outcomes" : "/tasks/queue",
    workspaceId,
  );
}

export function getMobileTasksDashboardHref(workspaceId?: string | null) {
  return getTabletDashboardHref("tasks", workspaceId);
}

export function getMobilePlanningDashboardHref(workspaceId?: string | null) {
  return getTabletDashboardHref("planning", workspaceId);
}

export function getMobileShellModeActions(
  currentMode: TabletShellMode,
  workspaceId?: string | null,
): MobileShellModeAction[] {
  return [
    {
      key: "ooda",
      label: "OODA",
      href: getTabletDashboardHref("ooda", workspaceId),
      isActive: currentMode === "ooda",
    },
    {
      key: "planning",
      label: "Planning",
      href: getMobilePlanningDashboardHref(workspaceId),
      isActive: currentMode === "planning",
    },
    {
      key: "tasks",
      label: "Tasks",
      href: getMobileTasksDashboardHref(workspaceId),
      isActive: currentMode === "tasks",
    },
  ];
}

export function getMobileShellGlobalActions(
  workspaceId?: string | null,
): MobileShellGlobalAction[] {
  return [
    {
      key: "settings",
      label: "Settings",
      href: getTabletSettingsHref(workspaceId),
      accessibilityLabel: "Open settings",
    },
  ];
}

export function getMobileDetailBackAction(
  input: MobileDetailBackSource,
): MobileDetailBackAction {
  if (input.source === "execution-session") {
    return {
      label: "Tasks",
      accessibilityLabel: "Back to tasks",
      href: getMobileTasksDashboardHref(input.workspaceId),
    };
  }

  if (input.source === "planning-session") {
    return {
      label: "Planning",
      accessibilityLabel: "Back to planning",
      href: getMobilePlanningDashboardHref(input.workspaceId),
    };
  }

  if (input.view === "queue") {
    return {
      label: "Priority Queue",
      accessibilityLabel: "Back to priority queue",
      href: getMobileTaskTabHref("priority-queue", input.workspaceId),
    };
  }

  if (input.view === "outcome") {
    return {
      label: "Recent Outcomes",
      accessibilityLabel: "Back to recent outcomes",
      href: getMobileTaskTabHref("recent-outcomes", input.workspaceId),
    };
  }

  return {
    label: "Planning",
    accessibilityLabel: "Back to planning",
    href: getMobilePlanningDashboardHref(input.workspaceId),
  };
}

export function getTabletTaskLaneHref(
  lane: TaskLaneKey,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(`/tasks?lane=${lane}`, workspaceId);
}

export function getTabletTaskLaneWorkItemHref(
  target: RunningNowWorkItemTarget,
  workspaceId?: string | null,
) {
  return getTabletWorkItemHref(target.workItemId, target.view, workspaceId);
}

export function getTabletWorkItemHref(
  workItemId: string,
  view: MobileWorkItemEntryView,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/work-items/${encodeURIComponent(workItemId)}?view=${view}`,
    workspaceId,
  );
}

export function getTabletSessionHref(
  sessionId: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/sessions/${encodeURIComponent(sessionId)}`,
    workspaceId,
  );
}

export function getTabletPlanningSessionHref(
  sessionId: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/planning/sessions/${encodeURIComponent(sessionId)}`,
    workspaceId,
  );
}

export function getTabletProviderHref(
  provider: ProviderKey,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(`/providers/${provider}`, workspaceId);
}

export function getTabletSettingsHref(workspaceId?: string | null) {
  return appendWorkspaceParam("/settings", workspaceId);
}

export function getTabletProjectsHref(
  workspaceId?: string | null,
  filter?: string | null,
) {
  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  if (workspaceId) params.set("workspace", workspaceId);
  const query = params.toString();

  return query ? (`/projects?${query}` as const) : ("/projects" as const);
}

export function getMobilePlanningFilterHref(
  filter: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/planning?filter=${encodeURIComponent(filter)}`,
    workspaceId,
  );
}

export function getTabletProjectHref(
  projectId: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/projects/${encodeURIComponent(projectId)}`,
    workspaceId,
  );
}
