import { getPlanningHref } from "../planning/navigation";
import type { ProviderKey, TaskLaneKey } from "./dashboard";
import type { RunningNowWorkItemTarget } from "./dashboard";
import type { TabletShellMode } from "./shell";
import type { TasksLeftRailTab } from "./shell";
import type { MobileWorkItemEntryView } from "./work-item-entry";

export interface MobileShellModeAction {
  key: TabletShellMode;
  label: "Planning" | "Tasks";
  href: string;
  isActive: boolean;
}

export interface MobileShellGlobalAction {
  key: "settings";
  label: "Settings";
  href: string;
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
  href: string;
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;

  const [pathname = path, queryString = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

export function getTabletDashboardHref(
  mode: TabletShellMode = "tasks",
  workspaceId?: string | null,
): string {
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
): string {
  return appendWorkspaceParam(
    tab === "recent-outcomes" ? "/tasks/outcomes" : "/tasks/queue",
    workspaceId,
  );
}

export function getMobileTasksDashboardHref(workspaceId?: string | null): string {
  return getTabletDashboardHref("tasks", workspaceId);
}

export function getMobilePlanningDashboardHref(workspaceId?: string | null): string {
  return getTabletDashboardHref("planning", workspaceId);
}

export function getMobileShellModeActions(
  currentMode: TabletShellMode,
  workspaceId?: string | null,
): MobileShellModeAction[] {
  return [
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
): string {
  return appendWorkspaceParam(`/tasks?lane=${lane}`, workspaceId);
}

export function getTabletTaskLaneWorkItemHref(
  target: RunningNowWorkItemTarget,
  workspaceId?: string | null,
): string {
  return getTabletWorkItemHref(target.workItemId, target.view, workspaceId);
}

export function getTabletWorkItemHref(
  workItemId: string,
  view: MobileWorkItemEntryView,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}?view=${view}`, workspaceId);
}

export function getTabletSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/sessions/${sessionId}`, workspaceId);
}

export function getTabletPlanningSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/planning/sessions/${sessionId}`, workspaceId);
}

export function getTabletProviderHref(
  provider: ProviderKey,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/providers/${provider}`, workspaceId);
}

export function getTabletSettingsHref(workspaceId?: string | null): string {
  return appendWorkspaceParam("/settings", workspaceId);
}

export function getTabletProjectsHref(
  workspaceId?: string | null,
  filter?: string | null,
): string {
  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  if (workspaceId) params.set("workspace", workspaceId);
  const query = params.toString();

  return query ? `/projects?${query}` : "/projects";
}

export function getMobilePlanningFilterHref(
  filter: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/planning?filter=${filter}`, workspaceId);
}

export function getTabletProjectHref(
  projectId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/projects/${projectId}`, workspaceId);
}
