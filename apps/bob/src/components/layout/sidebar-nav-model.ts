import {
  buildRecentOutcomeItems,
  formatPipelineStatus,
  getRecentlyCompletedWorkItemHref,
  type WorkPipelineItem,
} from "../dashboard/work-pipeline-model";
import {
  buildPriorityQueueRows,
  formatTaskPriority,
  getPriorityQueueWorkItemHref,
  type PriorityQueueItem,
} from "../tasks/task-shell-model";
import {
  buildPlanningSessionGroups,
  formatPlanningSessionOutputLabel,
  formatPlanningSessionStatus,
  type PlanningDashboardSession,
} from "../planning/planning-dashboard-model";
import { getPlanningSessionHref } from "../planning/planning-shell-model";
import { getProjectConfigurationHref } from "../projects/project-detail-tabs-model";

export type SidebarShellMode = "tasks" | "planning";

export interface SidebarModeItem {
  key: SidebarShellMode;
  label: "Tasks" | "Planning";
  href: "/tasks" | "/planning";
  icon: SidebarShellMode;
}

export interface SidebarTabItem {
  key: string;
  label: string;
  href: string;
}

export interface SidebarUtilityItem {
  key: "onboarding" | "pull-requests" | "nodes";
  label: "Onboarding" | "Pull Requests" | "Nodes";
  href: "/onboarding" | "/pull-requests" | "/nodes";
}

export interface SidebarProjectSummary {
  id: string;
  name?: string | null;
  key?: string | null;
  workspaceId?: string | null;
  updatedAt?: string | Date | null;
}

export interface SidebarProjectEntry {
  project?: SidebarProjectSummary | null;
}

export interface SidebarExecutionSessionSummary {
  id: string;
  sessionId?: string | null;
  title?: string | null;
  status?: string | null;
  agentType?: string | null;
  sessionType?: string | null;
  workspaceId?: string | null;
  workItemId?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  lastActivityAt?: string | Date | null;
  session?: {
    title?: string | null;
  } | null;
}

export type SidebarTabBadgeKey =
  | "recent-outcomes"
  | "priority-queue"
  | "recent-sessions"
  | "projects";

export type SidebarTabBadges = Record<SidebarTabBadgeKey, number>;

export interface SidebarTabBadgeInput {
  workItems: Array<WorkPipelineItem & PriorityQueueItem>;
  executionSessions?: SidebarExecutionSessionSummary[];
  planningSessions: PlanningDashboardSession[];
  projects: SidebarProjectSummary[];
}

export type SidebarRailStatusTone = "success" | "warning" | "danger" | "default";

export interface SidebarRailRow {
  id: string;
  title: string;
  statusLabel: string;
  statusTone: SidebarRailStatusTone;
  agentLabel: string;
  detailLabel?: string;
  lastUpdatedLabel: string;
  href: string;
}

export interface SidebarRailRowInput extends SidebarTabBadgeInput {
  tab: SidebarTabBadgeKey;
  workspaceId?: string | null;
  now?: Date;
  limit?: number;
}

const MODE_ITEMS: SidebarModeItem[] = [
  { key: "planning", label: "Planning", href: "/planning", icon: "planning" },
  { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
];

const TASK_TABS: SidebarTabItem[] = [
  { key: "recent-outcomes", label: "Recent Outcomes", href: "/runs" },
  { key: "priority-queue", label: "Priority Queue", href: "/tasks/queue" },
];

const PLANNING_TABS: SidebarTabItem[] = [
  { key: "recent-sessions", label: "Recent Sessions", href: "/planning" },
  { key: "projects", label: "Projects", href: "/planning/projects" },
];

const UTILITY_ITEMS: SidebarUtilityItem[] = [
  { key: "onboarding", label: "Onboarding", href: "/onboarding" },
  { key: "pull-requests", label: "Pull Requests", href: "/pull-requests" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
];

const WORK_ITEM_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "error",
  "failed",
  "interrupted",
  "review",
  "in_review",
  "stopped",
]);

const WORKSPACE_SCOPED_NAV_PATHS = new Set([
  "/onboarding",
  "/tasks",
  "/tasks/queue",
  "/runs",
  "/planning",
  "/planning/projects",
]);

const ACTIVE_EXECUTION_SESSION_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);

export function getSidebarModeItems(): SidebarModeItem[] {
  return [...MODE_ITEMS];
}

export function getDefaultSidebarShellHref(): SidebarModeItem["href"] {
  return "/tasks";
}

export function getSidebarModeTabs(mode: SidebarShellMode): SidebarTabItem[] {
  return mode === "tasks" ? [...TASK_TABS] : [...PLANNING_TABS];
}

export function getSidebarUtilityItems(): SidebarUtilityItem[] {
  return [...UTILITY_ITEMS];
}

export function getSidebarActiveTabKeyForPath(
  pathname: string,
  searchParams?: string | URLSearchParams | null,
): SidebarTabBadgeKey {
  const path = pathname.split("?")[0] ?? pathname;
  const mode = getSidebarModeForPath(path);

  if (mode === "planning") {
    if (path.startsWith("/planning/projects") || path.startsWith("/projects")) {
      return "projects";
    }
    return "recent-sessions";
  }

  if (path.startsWith("/tasks/queue")) {
    return "priority-queue";
  }

  if (path.startsWith("/work-items/")) {
    const params =
      typeof searchParams === "string"
        ? new URLSearchParams(searchParams)
        : searchParams;
    const view = params?.get("view");

    if (view === "queue") return "priority-queue";
    return "recent-outcomes";
  }

  return "recent-outcomes";
}

export function getSidebarModeForPath(pathname: string): SidebarShellMode {
  const path = pathname.split("?")[0] ?? pathname;

  if (
    path.startsWith("/planning") ||
    path.startsWith("/projects")
  ) {
    return "planning";
  }

  return "tasks";
}

export function getSidebarScopedHref(
  href: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return href;

  const [pathname = href, queryString = ""] = href.split("?");
  if (!WORKSPACE_SCOPED_NAV_PATHS.has(pathname)) return href;

  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export function buildSidebarTabBadges(input: SidebarTabBadgeInput): SidebarTabBadges {
  const planningGroups = buildPlanningSessionGroups(input.planningSessions);
  const recentOutcomeItems = buildRecentOutcomeItems(
    input.workItems,
    Number.MAX_SAFE_INTEGER,
  );
  const sessionOnlyOutcomes = buildSessionOnlyRecentOutcomeRows(
    input.executionSessions ?? [],
    Number.MAX_SAFE_INTEGER,
  );

  return {
    "recent-outcomes": recentOutcomeItems.length + sessionOnlyOutcomes.length,
    "priority-queue": buildPriorityQueueRows(input.workItems).length,
    "recent-sessions": planningGroups.recent.length,
    projects: input.projects.length,
  };
}

export function buildSidebarProjectSummaries(
  projects: SidebarProjectEntry[],
): SidebarProjectSummary[] {
  return projects.flatMap((entry) =>
    entry.project?.id
      ? [{
          id: entry.project.id,
          name: entry.project.name,
          key: entry.project.key,
          workspaceId: entry.project.workspaceId,
          updatedAt: entry.project.updatedAt,
        }]
      : [],
  );
}

export function buildSidebarRailRows(input: SidebarRailRowInput): SidebarRailRow[] {
  const limit = input.limit ?? 4;
  const now = input.now ?? new Date();

  switch (input.tab) {
    case "recent-outcomes": {
      const itemRows = buildRecentOutcomeItems(input.workItems, Number.MAX_SAFE_INTEGER).map(
        (item) => ({
          row: {
            id: item.id,
            title: `${item.identifier} · ${item.title}`,
            statusLabel: formatPipelineStatus(outcomeStatus(item)),
            statusTone: statusTone(outcomeStatus(item)),
            agentLabel: formatAgentLabel(item.agentStatus?.agentType ?? item.kind),
            lastUpdatedLabel: formatLastUpdatedLabel(item.completedAt ?? item.updatedAt, now),
            href: getRecentlyCompletedWorkItemHref(item.id, item.workspaceId ?? input.workspaceId),
          },
          timestamp: timestampValue(item.completedAt ?? item.updatedAt),
        }),
      );
      const sessionRows = buildSessionOnlyRecentOutcomeRows(
        input.executionSessions ?? [],
        Number.MAX_SAFE_INTEGER,
      ).map((session) => ({
        row: {
          id: session.sessionId ?? session.id,
          title: formatExecutionSessionTitle(session),
          statusLabel: formatPipelineStatus(session.status ?? "unknown"),
          statusTone: statusTone(session.status ?? "unknown"),
          agentLabel: formatAgentLabel(session.agentType ?? "Agent"),
          lastUpdatedLabel: formatLastUpdatedLabel(executionSessionActivityAt(session), now),
          href: getExecutionSessionHref(session, input.workspaceId),
        },
        timestamp: timestampValue(executionSessionActivityAt(session)),
      }));

      return [...itemRows, ...sessionRows]
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, limit)
        .map((entry) => entry.row);
    }
    case "priority-queue":
      return buildPriorityQueueRows(input.workItems).slice(0, limit).map((item) => ({
        id: item.id,
        title: `${item.identifier} · ${item.title}`,
        statusLabel: formatTaskPriority(item.priority),
        statusTone: "default",
        agentLabel: formatPipelineStatus(item.status),
        lastUpdatedLabel: formatLastUpdatedLabel(item.updatedAt, now),
        href: getPriorityQueueWorkItemHref(item.id, item.workspaceId ?? input.workspaceId),
      }));
    case "recent-sessions": {
      const groups = buildPlanningSessionGroups(input.planningSessions);
      return groups.recent.slice(0, limit).map((session) => ({
        id: session.id,
        title: session.title?.trim() || "Untitled planning session",
        statusLabel: formatPlanningSessionStatus(session.status),
        statusTone: statusTone(session.status ?? "unknown"),
        agentLabel: session.planningProjectName?.trim() || "Planning",
        detailLabel: formatPlanningSessionOutputLabel(session),
        lastUpdatedLabel: formatLastUpdatedLabel(session.updatedAt ?? session.createdAt, now),
        href: getPlanningSessionHref(session.id, session.workspaceId ?? input.workspaceId),
      }));
    }
    case "projects":
      return input.projects.slice(0, limit).map((project) => ({
        id: project.id,
        title: project.key ? `${project.key} · ${project.name ?? project.id}` : project.name ?? project.id,
        statusLabel: "Project",
        statusTone: "default",
        agentLabel: "Config",
        lastUpdatedLabel: formatLastUpdatedLabel(project.updatedAt, now),
        href: getProjectConfigurationHref(project.id, project.workspaceId ?? input.workspaceId),
      }));
  }
}

function buildSessionOnlyRecentOutcomeRows(
  sessions: SidebarExecutionSessionSummary[],
  limit: number,
): SidebarExecutionSessionSummary[] {
  return sessions
    .filter((session) => {
      if (session.workItemId) return false;
      if (session.sessionType === "planning") return false;
      const status = session.status ?? "";
      return status.length > 0 && !ACTIVE_EXECUTION_SESSION_STATUSES.has(status);
    })
    .sort(
      (left, right) =>
        timestampValue(executionSessionActivityAt(right)) -
        timestampValue(executionSessionActivityAt(left)),
    )
    .slice(0, limit);
}

function executionSessionActivityAt(
  session: SidebarExecutionSessionSummary,
): string | Date | null | undefined {
  return session.lastActivityAt ?? session.completedAt ?? session.updatedAt ?? session.createdAt;
}

function formatExecutionSessionTitle(session: SidebarExecutionSessionSummary): string {
  return (
    session.session?.title?.trim() ||
    session.title?.trim() ||
    `${session.agentType ?? "Agent"} session`
  );
}

function getExecutionSessionHref(
  session: SidebarExecutionSessionSummary,
  workspaceId?: string | null,
): string {
  const sessionId = session.sessionId ?? session.id;
  const params = new URLSearchParams();
  const targetWorkspaceId = session.workspaceId ?? workspaceId;
  if (targetWorkspaceId) params.set("workspace", targetWorkspaceId);
  const query = params.toString();
  return query ? `/sessions/${sessionId}?${query}` : `/sessions/${sessionId}`;
}

function outcomeStatus(item: WorkPipelineItem & PriorityQueueItem): string {
  const agentStatus = item.agentStatus?.status;
  if (
    !WORK_ITEM_OUTCOME_STATUSES.has(item.status) &&
    (
      agentStatus === "cancelled" ||
      agentStatus === "canceled" ||
      agentStatus === "failed" ||
      agentStatus === "error" ||
      agentStatus === "interrupted" ||
      agentStatus === "stopped"
    )
  ) {
    return agentStatus;
  }

  return item.status;
}

function statusTone(status: string): SidebarRailStatusTone {
  if (status === "blocked" || status === "failed" || status === "error" || status === "interrupted") return "danger";
  if (status === "in_review" || status === "review" || status === "awaiting_input") return "warning";
  if (status === "done" || status === "completed" || status === "running" || status === "in_progress") return "success";
  return "default";
}

function formatAgentLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("plan")) return "Planning";

  return normalized
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLastUpdatedLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  const timestamp = timestampValue(value);
  if (!Number.isFinite(timestamp)) return "No activity";

  const diffMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function timestampValue(value: string | Date | null | undefined): number {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}
