import type { TaskLaneKey } from "./dashboard";
import { buildRecentOutcomeWorkItems, getRecentOutcomeRowModel } from "./dashboard";
import { buildPriorityQueueItems  } from "./queue";
import type {TabletQueueItem} from "./queue";
import type { MobileWorkItemEntryView } from "./work-item-entry";

export type TabletShellMode = "tasks" | "planning";
export type TabletShellStatusFilter = "all" | "running" | "completed" | "failed";

export type TasksLeftRailTab = "recent-outcomes" | "priority-queue";
export type PlanningLeftRailTab = "recent-sessions" | "projects";
export type TabletLeftRailTab = TasksLeftRailTab | PlanningLeftRailTab;

export type TabletShellTarget =
  | { type: "tasks-dashboard" }
  | { type: "planning-dashboard" }
  | { type: "projects-dashboard" }
  | { type: "work-item"; workItemId: string; view?: MobileWorkItemEntryView }
  | { type: "execution-session"; sessionId: string }
  | { type: "planning-session"; sessionId: string }
  | { type: "project"; projectId: string }
  | { type: "provider"; provider: "codex" | "cursor" }
  | { type: "task-lane"; lane: TaskLaneKey }
  | { type: "settings" };

export interface TabletShellState {
  mode: TabletShellMode;
  target: TabletShellTarget;
  leftTab: TabletLeftRailTab;
}

export interface TabletShellSelectionIntent {
  selectedWorkItemId: string | null;
  selectedSessionId: string | null;
  planningSessionId: string | null;
  workItemView: "planning" | "queue" | "outcome";
}

export interface TabletShellTab {
  key: TabletLeftRailTab;
  label: string;
}

export interface TabletShellModeItem {
  key: TabletShellMode;
  label: "Planning" | "Tasks";
}

export interface TabletShellGlobalAction {
  key: "settings";
  label: string;
  detailLabel: string;
}

export type TabletLeftRailTabBadges = Record<TabletLeftRailTab, number>;

export interface TabletLeftRailProjectSummary {
  id: string;
}

export interface TabletLeftRailBadgeInput {
  sessions: TabletShellSession[];
  workItems: TabletQueueItem[];
  projects: TabletLeftRailProjectSummary[];
}

export interface TabletShellSession {
  sessionId: string;
  status: string;
  agentType: string;
  sessionType?: string | null;
  title?: string;
  lastActivityAt: string;
  workItemId?: string | null;
  draftCount?: number | null;
  producedTaskCount?: number | null;
}

export interface TabletAgentRunSessionInput {
  id: string;
  sessionId?: string | null;
  status?: string | null;
  agentType?: string | null;
  sessionType?: string | null;
  title?: string | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
  workItemId?: string | null;
  session?: {
    title?: string | null;
    status?: string | null;
    sessionType?: string | null;
    agentType?: string | null;
    lastActivityAt?: string | Date | null;
  } | null;
}

export type TabletShellStatusTone = "success" | "warning" | "danger" | "default";

export interface TabletShellSessionRow<TSession extends TabletShellSession = TabletShellSession> {
  session: TSession;
  sessionId: string;
  title: string;
  agentLabel: string;
  detailLabel?: string;
  statusLabel: string;
  statusTone: TabletShellStatusTone;
  lastUpdatedLabel: string;
  target: TabletShellTarget;
  entryView: "outcome" | null;
}

export interface TabletRecentOutcomeRailRow {
  id: string;
  title: string;
  statusLabel: string;
  statusTone: TabletShellStatusTone;
  agentLabel: string;
  lastUpdatedLabel: string;
  target: TabletShellTarget;
  href: string;
  entryView: "outcome" | null;
  accessibilityLabel: string;
}

export interface TabletRecentOutcomeTarget {
  target: TabletShellTarget;
  entryView: "outcome" | null;
  leftTab: TasksLeftRailTab;
}

export interface TabletPlanningPaneSession {
  sessionId: string;
  status: string;
  sessionType: string | null;
  title: string;
}

export type TabletShellRouteParams = Record<string, string | string[] | undefined>;

const TASK_TABS: TabletShellTab[] = [
  { key: "recent-outcomes", label: "Recent Outcomes" },
  { key: "priority-queue", label: "Priority Queue" },
];

const PLANNING_TABS: TabletShellTab[] = [
  { key: "recent-sessions", label: "Recent Sessions" },
  { key: "projects", label: "Projects" },
];

const MODE_ITEMS: TabletShellModeItem[] = [
  { key: "planning", label: "Planning" },
  { key: "tasks", label: "Tasks" },
];

const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);
const COMPLETED_FILTER_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "idle",
  "stopped",
]);
const FAILED_FILTER_STATUSES = new Set(["error", "failed", "interrupted"]);

export function getDefaultLeftRailTab(mode: TabletShellMode): TabletLeftRailTab {
  return mode === "tasks" ? "recent-outcomes" : "recent-sessions";
}

export function getDefaultShellTarget(mode: TabletShellMode): TabletShellTarget {
  return mode === "tasks"
    ? { type: "tasks-dashboard" }
    : { type: "planning-dashboard" };
}

export function getShellHeaderTitle(): string | null {
  return null;
}

export function switchShellMode(mode: TabletShellMode): TabletShellState {
  return {
    mode,
    target: getDefaultShellTarget(mode),
    leftTab: getDefaultLeftRailTab(mode),
  };
}

export function getExecutionSessionShellState(sessionId: string): TabletShellState {
  return {
    mode: "tasks",
    leftTab: "recent-outcomes",
    target: { type: "execution-session", sessionId },
  };
}

export function getShellStateForPath(
  pathname: string,
  params: TabletShellRouteParams = {},
  currentMode: TabletShellMode = "tasks",
): TabletShellState {
  const path = normalizePath(pathname);
  const lane = normalizeTaskLane(readParam(params, "lane"));
  const provider = normalizeProvider(readParam(params, "provider") ?? pathSegment(path, 1));
  const workItemId = readParam(params, "workItemId") ?? pathSegment(path, 1);
  const workItemView = normalizeWorkItemRouteView(readParam(params, "view"));
  const sessionId = readParam(params, "sessionId") ?? pathSegment(path, 1);
  const projectId = readParam(params, "projectId") ?? pathSegment(path, 1);

  if (path === "/settings" || path.startsWith("/settings/")) {
    return {
      mode: currentMode,
      leftTab: getDefaultLeftRailTab(currentMode),
      target: { type: "settings" },
    };
  }

  if (path === "/tasks" && lane) {
    return {
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "task-lane", lane },
    };
  }

  if (path === "/tasks/queue") {
    return {
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "tasks-dashboard" },
    };
  }

  if (path === "/tasks/outcomes") {
    return {
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "tasks-dashboard" },
    };
  }

  if (path.startsWith("/providers/") && provider) {
    return {
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "provider", provider },
    };
  }

  if (path.startsWith("/work-items/") && workItemId) {
    return {
      mode: "tasks",
      leftTab: workItemView === "outcome" ? "recent-outcomes" : "priority-queue",
      target: {
        type: "work-item",
        workItemId,
        view: workItemView,
      },
    };
  }

  if (path.startsWith("/sessions/") && sessionId) {
    return {
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "execution-session", sessionId },
    };
  }

  if (path.startsWith("/planning/sessions/") && sessionId) {
    return {
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-session", sessionId },
    };
  }

  if (path.startsWith("/projects/") && projectId) {
    return {
      mode: "planning",
      leftTab: "projects",
      target: { type: "project", projectId },
    };
  }

  if (path === "/projects" || path.startsWith("/projects/")) {
    return {
      mode: "planning",
      leftTab: "projects",
      target: { type: "projects-dashboard" },
    };
  }

  if (path === "/planning" || path.startsWith("/planning/")) {
    return switchShellMode("planning");
  }

  return switchShellMode("tasks");
}

export function getLeftRailTabs(mode: TabletShellMode): TabletShellTab[] {
  return mode === "tasks" ? TASK_TABS : PLANNING_TABS;
}

export function getShellModeItems(): TabletShellModeItem[] {
  return [...MODE_ITEMS];
}

export function buildLeftRailTabBadges(
  input: TabletLeftRailBadgeInput,
): TabletLeftRailTabBadges {
  const grouped = groupShellSessions(input.sessions);

  return {
    "recent-outcomes": grouped.recentOutcomes.length,
    "priority-queue": buildPriorityQueueItems(input.workItems).length,
    "recent-sessions": grouped.recentPlanning.length,
    projects: input.projects.length,
  };
}

export function getRightRailTitle(mode: TabletShellMode): string {
  return mode === "tasks" ? "Running Now" : "Active Sessions";
}

function normalizeWorkspaceName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Workspace";
}

export function getShellGlobalActions(
  workspaceName?: string | null,
): TabletShellGlobalAction[] {
  return [
    {
      key: "settings",
      label: "Settings",
      detailLabel: normalizeWorkspaceName(workspaceName),
    },
  ];
}

export function getShellHeaderStatusLabel(input: {
  workspaceName?: string | null;
  connectionState: string;
  sessionCount: number;
}): string {
  const workspaceName = normalizeWorkspaceName(input.workspaceName);
  const status =
    input.connectionState === "connected"
      ? `${input.sessionCount} session${input.sessionCount === 1 ? "" : "s"}`
      : input.connectionState;

  return `${workspaceName} · ${status}`;
}

export function selectLeftRailTarget(
  mode: TabletShellMode,
  tab: TabletLeftRailTab,
): TabletShellTarget {
  if (mode === "planning" && tab === "projects") {
    return { type: "projects-dashboard" };
  }

  return getDefaultShellTarget(mode);
}

export function getShellModeForTarget(
  target: TabletShellTarget,
  currentMode: TabletShellMode = "tasks",
): TabletShellMode {
  switch (target.type) {
    case "planning-dashboard":
    case "projects-dashboard":
    case "planning-session":
    case "project":
      return "planning";
    case "tasks-dashboard":
    case "work-item":
    case "execution-session":
    case "provider":
    case "task-lane":
      return "tasks";
    case "settings":
      return currentMode;
  }
}

export function getShellSelectionIntent(
  state: TabletShellState,
): TabletShellSelectionIntent {
  if (state.target.type === "work-item") {
    return {
      selectedWorkItemId: state.target.workItemId,
      selectedSessionId: null,
      planningSessionId: null,
      workItemView:
        state.target.view ??
        (state.leftTab === "recent-outcomes" ? "outcome" : "queue"),
    };
  }

  if (state.target.type === "execution-session") {
    return {
      selectedWorkItemId: null,
      selectedSessionId: state.target.sessionId,
      planningSessionId: null,
      workItemView: "planning",
    };
  }

  if (state.target.type === "planning-session") {
    return {
      selectedWorkItemId: null,
      selectedSessionId: null,
      planningSessionId: state.target.sessionId,
      workItemView: "planning",
    };
  }

  return {
    selectedWorkItemId: null,
    selectedSessionId: null,
    planningSessionId: null,
    workItemView: "planning",
  };
}

export function isNativeTabletShellTarget(target: TabletShellTarget): boolean {
  switch (target.type) {
    case "tasks-dashboard":
    case "planning-dashboard":
    case "projects-dashboard":
    case "work-item":
    case "execution-session":
    case "planning-session":
    case "project":
    case "provider":
    case "task-lane":
    case "settings":
      return true;
  }
}

export function getRecentOutcomeTarget(
  session: TabletShellSession,
): TabletRecentOutcomeTarget {
  if (session.workItemId) {
    return {
      target: { type: "work-item", workItemId: session.workItemId },
      entryView: "outcome",
      leftTab: "recent-outcomes",
    };
  }

  return {
    target: { type: "execution-session", sessionId: session.sessionId },
    entryView: null,
    leftTab: "recent-outcomes",
  };
}

export function getPlanningPaneSession<T extends TabletShellSession>(
  sessions: T[],
  sessionId: string,
): TabletPlanningPaneSession {
  const session = sessions.find((candidate) => candidate.sessionId === sessionId);

  return {
    sessionId,
    status: session?.status ?? "unknown",
    sessionType: session?.sessionType ?? null,
    title: session?.title ?? "",
  };
}

export function isPlanningSession(session: TabletShellSession): boolean {
  if (session.sessionType === "planning") return true;
  if (session.sessionType === "execution") return false;

  const agentType = session.agentType.toLowerCase();
  return agentType.includes("plan") || agentType.includes("planner");
}

export function isActiveShellSession(session: TabletShellSession): boolean {
  return ACTIVE_STATUSES.has(session.status);
}

export function matchesShellSessionStatusFilter(
  status: string,
  filter: TabletShellStatusFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "running":
      return ACTIVE_STATUSES.has(status);
    case "completed":
      return COMPLETED_FILTER_STATUSES.has(status);
    case "failed":
      return FAILED_FILTER_STATUSES.has(status);
  }
}

export function groupShellSessions<T extends TabletShellSession>(sessions: T[]) {
  const ordered = [...sessions].sort(
    (left, right) =>
      new Date(right.lastActivityAt).getTime() -
      new Date(left.lastActivityAt).getTime(),
  );

  return {
    tasksActive: ordered.filter(
      (session) => !isPlanningSession(session) && isActiveShellSession(session),
    ),
    recentOutcomes: ordered.filter(
      (session) => !isPlanningSession(session) && !isActiveShellSession(session),
    ),
    planningActive: ordered.filter(
      (session) => isPlanningSession(session) && isActiveShellSession(session),
    ),
    recentPlanning: ordered.filter(
      (session) => isPlanningSession(session) && !isActiveShellSession(session),
    ),
  };
}

export function buildShellSessionRows<T extends TabletShellSession>(
  sessions: T[],
  options: { now?: Date } = {},
): TabletShellSessionRow<T>[] {
  const now = options.now ?? new Date();

  return sessions.map((session) => {
    const target = getShellSessionRowTarget(session);

    return {
      session,
      sessionId: session.sessionId,
      title: formatShellSessionTitle(session),
      agentLabel: formatAgentLabel(session.agentType),
      detailLabel: isPlanningSession(session) ? formatPlanningOutputLabel(session) : undefined,
      statusLabel: formatShellStatusLabel(session.status),
      statusTone: getShellStatusTone(session.status),
      lastUpdatedLabel: formatLastUpdatedLabel(session.lastActivityAt, now),
      target: target.target,
      entryView: target.entryView,
    };
  });
}

export function buildRecentOutcomeRailRows(input: {
  workItems: TabletQueueItem[];
  sessions: TabletShellSession[];
  workspaceId?: string | null;
  now?: Date;
  limit?: number;
}): TabletRecentOutcomeRailRow[] {
  const now = input.now ?? new Date();
  const workItemRows = buildRecentOutcomeWorkItems(
    input.workItems,
    Number.MAX_SAFE_INTEGER,
  ).map((item) => {
    const row = getRecentOutcomeRowModel(item, { now });
    const title = `${item.identifier} · ${item.title}`;

    return {
      row: {
        id: `work-item:${item.id}`,
        title,
        statusLabel: row.statusLabel,
        statusTone: getRecentOutcomeWorkItemTone(row.status),
        agentLabel: row.agentLabel,
        lastUpdatedLabel: row.lastUpdatedLabel,
        target: { type: "work-item", workItemId: item.id },
        href: appendWorkspaceParam(`/work-items/${item.id}?view=outcome`, input.workspaceId),
        entryView: "outcome",
        accessibilityLabel: `${row.accessibilityLabel}, updated ${row.lastUpdatedLabel}`,
      } satisfies TabletRecentOutcomeRailRow,
      sortValue: timestampValue(item.completedAt ?? item.updatedAt),
    };
  });
  const sessionRows = groupShellSessions(input.sessions).recentOutcomes
    .filter((session) => !session.workItemId)
    .map((session) => ({
      row: {
        id: `session:${session.sessionId}`,
        title: formatShellSessionTitle(session),
        statusLabel: formatShellStatusLabel(session.status),
        statusTone: getShellStatusTone(session.status),
        agentLabel: formatAgentLabel(session.agentType),
        lastUpdatedLabel: formatLastUpdatedLabel(session.lastActivityAt, now),
        target: { type: "execution-session", sessionId: session.sessionId },
        href: appendWorkspaceParam(`/sessions/${session.sessionId}`, input.workspaceId),
        entryView: null,
        accessibilityLabel: `${formatShellSessionTitle(session)}, ${formatShellStatusLabel(session.status)}, updated ${formatLastUpdatedLabel(session.lastActivityAt, now)}`,
      } satisfies TabletRecentOutcomeRailRow,
      sortValue: timestampValue(session.lastActivityAt),
    }));

  return [...workItemRows, ...sessionRows]
    .sort((left, right) => right.sortValue - left.sortValue)
    .slice(0, input.limit ?? 8)
    .map((entry) => entry.row);
}

export function buildTabletShellSessionsFromAgentRuns(
  runs: TabletAgentRunSessionInput[],
): TabletShellSession[] {
  return runs.flatMap((run) => {
    if (!run.sessionId) return [];

    return [
      {
        sessionId: run.sessionId,
        status: run.status ?? run.session?.status ?? "unknown",
        agentType: run.agentType ?? run.session?.agentType ?? "agent",
        title: run.session?.title ?? run.title ?? run.agentType ?? "Agent run",
        lastActivityAt: formatDateValue(
          run.session?.lastActivityAt ??
            run.completedAt ??
            run.startedAt ??
            run.createdAt,
        ),
        workItemId: run.workItemId ?? null,
        sessionType: run.sessionType ?? run.session?.sessionType ?? "execution",
      },
    ];
  });
}

function getShellSessionRowTarget(session: TabletShellSession): {
  target: TabletShellTarget;
  entryView: "outcome" | null;
} {
  if (isPlanningSession(session)) {
    return {
      target: { type: "planning-session", sessionId: session.sessionId },
      entryView: null,
    };
  }

  const recentOutcome = getRecentOutcomeTarget(session);
  return {
    target: recentOutcome.target,
    entryView: recentOutcome.entryView,
  };
}

function formatPlanningOutputLabel(session: TabletShellSession): string {
  const draftCount = normalizeCount(session.draftCount);
  const taskCount = normalizeCount(session.producedTaskCount);

  if (draftCount === 0 && taskCount === 0) return "No drafts";
  return [
    draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : null,
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readParam(
  params: TabletShellRouteParams,
  key: string,
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeWorkItemRouteView(
  value: string | undefined,
): MobileWorkItemEntryView {
  if (value === "queue" || value === "outcome" || value === "planning") {
    return value;
  }

  return "planning";
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;

  const [pathname = path, queryString = ""] = path.split("?");
  const params = new URLSearchParams(queryString);
  params.set("workspace", workspaceId);
  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

function normalizePath(pathname: string): string {
  const [path = "/"] = pathname.split("?");
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function pathSegment(pathname: string, index: number): string | undefined {
  return pathname.split("/").filter(Boolean)[index];
}

function normalizeProvider(value: string | undefined): "codex" | "cursor" | null {
  return value === "codex" || value === "cursor" ? value : null;
}

function normalizeTaskLane(value: string | undefined): TaskLaneKey | null {
  return value === "needs-attention" ||
    value === "ready" ||
    value === "active" ||
    value === "review"
    ? value
    : null;
}

function formatShellSessionTitle(session: TabletShellSession): string {
  const title = session.title?.trim();
  return title && title.length > 0 ? title : session.agentType;
}

function formatAgentLabel(agentType: string): string {
  const normalized = agentType.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";
  if (normalized.includes("plan")) return "Planning";

  return normalized
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getShellStatusTone(status: string): TabletShellStatusTone {
  switch (status) {
    case "running":
      return "success";
    case "queued":
    case "starting":
    case "provisioning":
    case "pending":
    case "awaiting-input":
    case "awaiting_input":
    case "stopping":
      return "warning";
    case "error":
    case "failed":
    case "interrupted":
      return "danger";
    default:
      return "default";
  }
}

function getRecentOutcomeWorkItemTone(status: string): TabletShellStatusTone {
  if (status === "failed" || status === "error" || status === "interrupted") {
    return "danger";
  }
  if (status === "in_review" || status === "review") return "warning";
  return "success";
}

function formatShellStatusLabel(status: string): string {
  return status
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatLastUpdatedLabel(value: string, now: Date): string {
  const timestamp = new Date(value).getTime();
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
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatDateValue(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (value) return value;
  return new Date(0).toISOString();
}
