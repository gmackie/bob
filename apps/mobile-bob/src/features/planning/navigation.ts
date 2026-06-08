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

type DashboardItemSource = "notification" | "workItem" | "project";
type DashboardItemTone =
  | "accent"
  | "danger"
  | "warning"
  | "default"
  | "success";

export interface PlanningDashboardAction {
  id: string;
  source: DashboardItemSource;
  title: string;
  subtitle: string | null;
  ctaLabel: string;
  href: string;
  tone: DashboardItemTone;
}

export interface PlanningAttentionItem {
  id: string;
  source: Exclude<DashboardItemSource, "project">;
  title: string;
  subtitle: string | null;
  badge: string;
  href: string;
  tone: DashboardItemTone;
}

export function getPlanningHref(): string {
  return "/planning";
}

export function getAgentChatHref(): string {
  return "/chat";
}

export function getProjectHref(projectId: string, workspaceId?: string | null): string {
  if (!workspaceId) return `/projects/${projectId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/projects/${projectId}?${params.toString()}`;
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getWorkItemHref(workItemId: string, workspaceId?: string | null): string {
  return appendWorkspaceParam(`/work-items/${workItemId}`, workspaceId);
}

export function getTaskWorkspaceHref(workItemId: string, workspaceId?: string | null): string {
  return appendWorkspaceParam(`/work-items/${workItemId}/workspace`, workspaceId);
}

export function getSessionHref(sessionId: string, workspaceId?: string | null): string {
  return appendWorkspaceParam(`/sessions/${sessionId}`, workspaceId);
}

export function getNotificationTargetHref(data: {
  workItemId?: string | null;
  workspaceId?: string | null;
  url?: string | null;
}): string | null {
  if (data.workItemId) return getWorkItemHref(data.workItemId, data.workspaceId);
  return data.url ?? null;
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

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWorkItemTone(status: string): DashboardItemTone {
  if (status === "blocked") return "danger";
  if (status === "in_review") return "warning";
  if (status === "done" || status === "completed") return "success";
  return "default";
}

function getWorkItemPriority(status: string): number {
  if (status === "blocked") return 0;
  if (status === "in_review") return 1;
  if (status === "in_progress") return 2;
  return 3;
}

function getWorkItemActionHref(
  item: PlanningWorkItemSummary,
  workspaceId?: string | null,
): string {
  return item.kind === "task"
    ? getTaskWorkspaceHref(item.id, workspaceId)
    : getWorkItemHref(item.id, workspaceId);
}

export function groupPlanningWorkItems(workItems: PlanningWorkItemSummary[]) {
  return {
    queued: workItems.filter((item) =>
      ["ready", "todo", "backlog", "draft"].includes(item.status),
    ),
    active: workItems.filter((item) =>
      ["in_progress", "running"].includes(item.status),
    ),
    review: workItems.filter((item) =>
      ["blocked", "in_review", "review"].includes(item.status),
    ),
    done: workItems.filter((item) =>
      ["done", "completed", "cancelled", "canceled"].includes(item.status),
    ),
  };
}

function buildWorkItemSubtitle(item: PlanningWorkItemSummary): string {
  return `${item.identifier} · ${item.status.replace(/_/g, " ")}`;
}

function buildAttentionItems(input: {
  workItems: PlanningWorkItemSummary[];
  notifications: PlanningNotificationSummary[];
  workspaceId?: string | null;
}): PlanningAttentionItem[] {
  const unreadNotifications = input.notifications
    .filter((item) => !item.read)
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      source: "notification" as const,
      title: item.title,
      subtitle: item.body,
      badge: "Unread",
      href: getNotificationsHref(),
      tone: "accent" as const,
    }));

  const activeWorkItems = input.workItems
    .filter((item) =>
      ["blocked", "in_review", "in_progress"].includes(item.status),
    )
    .sort(
      (a, b) => getWorkItemPriority(a.status) - getWorkItemPriority(b.status),
    )
    .map((item) => ({
      id: item.id,
      source: "workItem" as const,
      title: item.title,
      subtitle: buildWorkItemSubtitle(item),
      badge: formatStatusLabel(item.status),
      href: getWorkItemActionHref(item, input.workspaceId),
      tone: getWorkItemTone(item.status),
    }));

  return [...unreadNotifications, ...activeWorkItems].slice(0, 5);
}

function buildPrimaryAction(input: {
  attentionItems: PlanningAttentionItem[];
  projects: PlanningProjectSummary[];
  workspaceId?: string | null;
}): PlanningDashboardAction | null {
  const firstAttentionItem = input.attentionItems[0];
  if (firstAttentionItem) {
    return {
      id: firstAttentionItem.id,
      source: firstAttentionItem.source,
      title: firstAttentionItem.title,
      subtitle: firstAttentionItem.subtitle,
      ctaLabel:
        firstAttentionItem.source === "notification"
          ? "Open inbox"
          : firstAttentionItem.href.includes("/workspace")
            ? "Open workspace"
            : "Open item",
      href: firstAttentionItem.href,
      tone: firstAttentionItem.tone,
    };
  }

  const firstProject = input.projects[0];
  if (!firstProject) return null;

  return {
    id: firstProject.id,
    source: "project",
    title: firstProject.name,
    subtitle: `${firstProject.taskCount} tasks · ${firstProject.issueCount} issues · ${firstProject.activeCount} active`,
    ctaLabel: "Open project",
    href: getProjectHref(firstProject.id, input.workspaceId),
    tone: "default",
  };
}

export function buildPlanningSections(input: {
  workspaces: PlanningWorkspaceSummary[];
  projects: PlanningProjectSummary[];
  workItems: PlanningWorkItemSummary[];
  notifications: PlanningNotificationSummary[];
}) {
  const workspaceId = input.workspaces[0]?.id ?? null;
  const attentionItems = buildAttentionItems({ ...input, workspaceId });

  return {
    heroWorkspace: input.workspaces[0] ?? null,
    featuredProjects: input.projects.slice(0, 4),
    workPipeline: groupPlanningWorkItems(input.workItems),
    recentWorkItems: input.workItems.slice(0, 8),
    unreadNotifications: input.notifications
      .filter((item) => !item.read)
      .slice(0, 5),
    primaryAction: buildPrimaryAction({
      attentionItems,
      projects: input.projects,
      workspaceId,
    }),
    attentionItems,
    projectTotals: input.projects.reduce(
      (acc, project) => ({
        total: acc.total + 1,
        active: acc.active + (project.activeCount > 0 ? 1 : 0),
        tasks: acc.tasks + project.taskCount,
        issues: acc.issues + project.issueCount,
      }),
      { total: 0, active: 0, tasks: 0, issues: 0 },
    ),
    executionSummary: groupActiveTaskStatuses(input.workItems),
  };
}
