export interface PlanningWorkspaceSummary {
  id: string;
  name: string;
  projectCount: number;
  activeTaskCount: number;
}

export interface PlanningProjectSummary {
  id: string;
  name: string;
  key: string;
  activeCount: number;
  issueCount: number;
  taskCount: number;
}

export interface PlanningWorkItemSummary {
  id: string;
  identifier: string;
  title: string;
  kind: "issue" | "epic" | "task";
  status: string;
}

export interface PlanningNotificationSummary {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
}

export function getPlanningHref(): string {
  return "/planning";
}

export function getAgentChatHref(): string {
  return "/chat";
}

export function getProjectHref(projectId: string): string {
  return `/projects/${projectId}`;
}

export function getWorkItemHref(workItemId: string): string {
  return `/work-items/${workItemId}`;
}

export function getTaskWorkspaceHref(workItemId: string): string {
  return `/work-items/${workItemId}/workspace`;
}

export function getNotificationsHref(): string {
  return "/notifications";
}

export function groupActiveTaskStatuses(workItems: PlanningWorkItemSummary[]): {
  inProgress: number;
  inReview: number;
  blocked: number;
} {
  return workItems.reduce(
    (acc, item) => {
      if (item.status === "in_progress") acc.inProgress += 1;
      if (item.status === "in_review") acc.inReview += 1;
      if (item.status === "blocked") acc.blocked += 1;
      return acc;
    },
    { inProgress: 0, inReview: 0, blocked: 0 },
  );
}

export function buildPlanningSections(input: {
  workspaces: PlanningWorkspaceSummary[];
  projects: PlanningProjectSummary[];
  workItems: PlanningWorkItemSummary[];
  notifications: PlanningNotificationSummary[];
}) {
  return {
    heroWorkspace: input.workspaces[0] ?? null,
    featuredProjects: input.projects.slice(0, 4),
    recentWorkItems: input.workItems.slice(0, 8),
    unreadNotifications: input.notifications.filter((item) => !item.read).slice(0, 5),
    executionSummary: groupActiveTaskStatuses(input.workItems),
  };
}
