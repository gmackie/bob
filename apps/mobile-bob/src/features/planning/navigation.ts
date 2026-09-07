import type { Href } from "expo-router";

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
  href: Extract<Href, string>;
  tone: DashboardItemTone;
}

export interface PlanningAttentionItem {
  id: string;
  source: Exclude<DashboardItemSource, "project">;
  title: string;
  subtitle: string | null;
  badge: string;
  href: Extract<Href, string>;
  tone: DashboardItemTone;
}

export function getPlanningHref() {
  return "/planning" as const;
}

export function getAgentChatHref() {
  return "/chat" as const;
}

export function getProjectHref(projectId: string, workspaceId?: string | null) {
  if (!workspaceId)
    return `/projects/${encodeURIComponent(projectId)}` as const;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/projects/${encodeURIComponent(projectId)}?${params.toString()}` as const;
}

export function appendWorkspaceParam<const Path extends `${string}?${string}`>(
  path: Path,
  workspaceId?: string | null,
): Path | `${Path}&workspace=${string}`;
export function appendWorkspaceParam<const Path extends string>(
  path: Path,
  workspaceId?: string | null,
): Path | `${Path}?workspace=${string}`;
export function appendWorkspaceParam(
  path: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/work-items/${encodeURIComponent(workItemId)}`,
    workspaceId,
  );
}

export function getTaskWorkspaceHref(
  workItemId: string,
  workspaceId?: string | null,
) {
  return appendWorkspaceParam(
    `/work-items/${encodeURIComponent(workItemId)}/workspace`,
    workspaceId,
  );
}

export function getSessionHref(sessionId: string, workspaceId?: string | null) {
  return appendWorkspaceParam(
    `/sessions/${encodeURIComponent(sessionId)}`,
    workspaceId,
  );
}

const NOTIFICATION_STATIC_ROUTES = [
  "/",
  "/home",
  "/chat",
  "/planning",
  "/tasks",
  "/tasks/queue",
  "/tasks/outcomes",
  "/projects",
  "/pull-requests",
  "/nodes",
  "/notifications",
  "/settings",
  "/settings/account",
  "/settings/api-keys",
  "/settings/appearance",
  "/settings/device",
  "/settings/notifications",
  "/settings/providers",
  "/settings/workspace",
] as const satisfies readonly Extract<Href, string>[];

function withSearch<const Path extends string>(path: Path, search: string) {
  return search ? (`${path}?${search}` as const) : path;
}

/** Push payloads are untrusted strings, not proof that a mobile route exists. */
function getNotificationUrlHref(
  value?: string | null,
): Extract<Href, string> | null {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  try {
    const url = new URL(value, "https://mobile.invalid");
    const pathname = url.pathname === "/runs" ? "/tasks" : url.pathname;
    const search = url.searchParams.toString();
    const fixed = NOTIFICATION_STATIC_ROUTES.find(
      (route) => route === pathname,
    );
    if (fixed) return withSearch(fixed, search);
    const parts = pathname.split("/");
    const id = parts[2];
    if (!id) return null;
    // Decode then encode a single segment so identifiers cannot inject routes or queries.
    const segment = encodeURIComponent(decodeURIComponent(id));
    if (parts.length === 3) {
      switch (parts[1]) {
        case "projects":
          return withSearch(`/projects/${segment}`, search);
        case "work-items":
          return withSearch(`/work-items/${segment}`, search);
        case "sessions":
          return withSearch(`/sessions/${segment}`, search);
        case "providers":
          return withSearch(`/providers/${segment}`, search);
      }
    }
    if (
      parts.length === 4 &&
      parts[1] === "work-items" &&
      parts[3] === "workspace"
    ) {
      return withSearch(`/work-items/${segment}/workspace`, search);
    }
    if (
      parts.length === 4 &&
      parts[1] === "planning" &&
      parts[2] === "sessions" &&
      parts[3]
    ) {
      return withSearch(
        `/planning/sessions/${encodeURIComponent(decodeURIComponent(parts[3]))}`,
        search,
      );
    }
    return null;
  } catch {
    return null;
  }
}

export function getNotificationTargetHref(data: {
  workItemId?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  url?: string | null;
}): Extract<Href, string> | null {
  if (data.workItemId)
    return getWorkItemHref(data.workItemId, data.workspaceId);
  // Ad-hoc runs (blocked/host_unknown/terminal pushes) have no work item —
  // deep-link straight to the run screen so a tap never dead-ends.
  if (data.sessionId) return getSessionHref(data.sessionId, data.workspaceId);
  return getNotificationUrlHref(data.url);
}

export function getNotificationsHref() {
  return "/notifications" as const;
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
) {
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
  return `${item.identifier} · ${item.status.replace(/_/g, " ")}` as const;
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
