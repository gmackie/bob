export interface PlanningDashboardSession {
  id: string;
  workspaceId?: string | null;
  status?: string | null;
  title?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  planningProjectName?: string | null;
  draftCount?: number | null;
  producedTaskCount?: number | null;
}

export interface PlanningSessionGroups<T extends PlanningDashboardSession> {
  active: T[];
  recent: T[];
}

export interface PlanningProjectOption {
  project?: {
    id: string;
    name: string;
    planningProvider?: string | null;
    linearProjectId?: string | null;
    automationSettings?: Record<string, unknown> | null;
  } | null;
  linkedRepository?: {
    path?: string | null;
    dirty?: boolean | null;
    stale?: boolean | null;
    discoveryStatus?: string | null;
  } | null;
}

export type PlanningDashboardSummaryTone = "default" | "warning" | "danger" | "success";
export type PlanningDashboardFilter = "drafts" | "awaiting-input";

export interface PlanningDashboardSessionRow {
  id: string;
  title: string;
  projectLabel: string;
  status: string;
  statusLabel: string;
  statusTone: PlanningDashboardSummaryTone;
  outputLabel: string;
  lastUpdatedLabel: string;
  href: string;
}

export interface PlanningDashboardSummaryCard {
  key:
    | "drafts-awaiting-commit"
    | "plans-needing-input"
    | "project-setup-issues"
    | "stale-project-sync"
    | "healthy-projects";
  title: string;
  count: number;
  tone: PlanningDashboardSummaryTone;
  href: string;
}

export type PlanningDashboardSection =
  | "summary-cards"
  | "recent-sessions"
  | "active-sessions-rail";

export interface PlanningDashboardSectionHeader {
  title: "Recent Sessions";
  subtitle: string | null;
}

const PLANNING_DASHBOARD_SECTIONS: PlanningDashboardSection[] = [
  "summary-cards",
  "recent-sessions",
  "active-sessions-rail",
];

const ACTIVE_PLANNING_STATUSES = new Set([
  "awaiting-input",
  "awaiting_input",
  "pending",
  "provisioning",
  "running",
  "starting",
]);
const AWAITING_INPUT_STATUSES = new Set(["awaiting-input", "awaiting_input"]);

export function isActivePlanningSession(session: PlanningDashboardSession): boolean {
  return ACTIVE_PLANNING_STATUSES.has((session.status ?? "").toLowerCase());
}

export function getPlanningDashboardSections(): PlanningDashboardSection[] {
  return [...PLANNING_DASHBOARD_SECTIONS];
}

export function getPlanningDashboardRecentSessionsHeader(
  filter: PlanningDashboardFilter | string | null | undefined,
): PlanningDashboardSectionHeader {
  const normalized = normalizePlanningDashboardFilter(filter ?? null);

  return {
    title: "Recent Sessions",
    subtitle: normalized ? formatPlanningSessionFilterTitle(normalized) : null,
  };
}

export function buildPlanningSessionGroups<T extends PlanningDashboardSession>(
  sessions: T[],
): PlanningSessionGroups<T> {
  const ordered = orderPlanningSessionsByActivity(sessions);

  return {
    active: ordered.filter(isActivePlanningSession),
    recent: ordered.filter((session) => !isActivePlanningSession(session)),
  };
}

export function normalizePlanningDashboardFilter(
  value: string | null | undefined,
): PlanningDashboardFilter | null {
  return value === "drafts" || value === "awaiting-input" ? value : null;
}

export function filterPlanningDashboardSessions<T extends PlanningDashboardSession>(
  sessions: T[],
  filter: PlanningDashboardFilter | string | null | undefined,
): T[] {
  const normalized = normalizePlanningDashboardFilter(filter ?? null);
  if (!normalized) return sessions;

  if (normalized === "drafts") {
    return sessions.filter((session) => normalizeCount(session.draftCount) > 0);
  }

  return sessions.filter((session) =>
    AWAITING_INPUT_STATUSES.has((session.status ?? "").toLowerCase()),
  );
}

export function formatPlanningSessionStatus(status?: string | null): string {
  if (!status) return "Unknown";
  return status
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatPlanningSessionOutputLabel(session: PlanningDashboardSession): string {
  const draftCount = normalizeCount(session.draftCount);
  const taskCount = normalizeCount(session.producedTaskCount);

  if (draftCount === 0 && taskCount === 0) return "No drafts";
  return [
    draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : null,
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
}

export function buildPlanningDashboardSessionRows(
  sessions: PlanningDashboardSession[],
  options: {
    workspaceId?: string | null;
    now?: Date;
  } = {},
): PlanningDashboardSessionRow[] {
  const now = options.now ?? new Date();

  return sessions.map((session) => {
    const status = session.status ?? "";

    return {
      id: session.id,
      title: normalizePlanningSessionTitle(session.title),
      projectLabel: normalizePlanningSessionProjectLabel(session.planningProjectName),
      status,
      statusLabel: formatPlanningSessionStatus(status),
      statusTone: getPlanningSessionStatusTone(status),
      outputLabel: formatPlanningSessionOutputLabel(session),
      lastUpdatedLabel: formatPlanningSessionLastUpdatedLabel(
        session.updatedAt ?? session.createdAt,
        now,
      ),
      href: getPlanningSessionHref(session.id, options.workspaceId),
    };
  });
}

export function selectDefaultPlanningProject(
  projects: PlanningProjectOption[],
): { id: string; name: string } | null {
  const firstProject = projects.find((entry) => Boolean(entry.project?.id));
  return firstProject?.project
    ? { id: firstProject.project.id, name: firstProject.project.name }
    : null;
}

export function buildPlanningDashboardSummaryCards(input: {
  workspaceId?: string | null;
  sessions: PlanningDashboardSession[];
  projects: PlanningProjectOption[];
}): PlanningDashboardSummaryCard[] {
  const draftCount = input.sessions.reduce(
    (total, session) => total + normalizeCount(session.draftCount),
    0,
  );
  const inputNeededCount = input.sessions.filter((session) =>
    AWAITING_INPUT_STATUSES.has((session.status ?? "").toLowerCase()),
  ).length;
  const setupIssueCount = input.projects.filter(hasProjectSetupIssue).length;
  const staleProjectCount = input.projects.filter((entry) =>
    Boolean(entry.linkedRepository?.stale),
  ).length;
  const healthyProjectCount = input.projects.filter((entry) =>
    !hasProjectSetupIssue(entry) && !entry.linkedRepository?.stale,
  ).length;

  return [
    {
      key: "drafts-awaiting-commit",
      title: "Drafts Awaiting Commit",
      count: draftCount,
      tone: draftCount > 0 ? "warning" : "default",
      href: getPlanningDashboardFilterHref("/planning", "drafts", input.workspaceId),
    },
    {
      key: "plans-needing-input",
      title: "Plans Needing Input",
      count: inputNeededCount,
      tone: inputNeededCount > 0 ? "warning" : "default",
      href: getPlanningDashboardFilterHref("/planning", "awaiting-input", input.workspaceId),
    },
    {
      key: "project-setup-issues",
      title: "Setup Issues",
      count: setupIssueCount,
      tone: setupIssueCount > 0 ? "danger" : "default",
      href: getPlanningDashboardFilterHref("/planning/projects", "setup-issues", input.workspaceId),
    },
    {
      key: "stale-project-sync",
      title: "Stale Sync",
      count: staleProjectCount,
      tone: staleProjectCount > 0 ? "warning" : "default",
      href: getPlanningDashboardFilterHref("/planning/projects", "stale-sync", input.workspaceId),
    },
    {
      key: "healthy-projects",
      title: "Healthy Projects",
      count: healthyProjectCount,
      tone: healthyProjectCount > 0 ? "success" : "default",
      href: getPlanningDashboardFilterHref("/planning/projects", "healthy", input.workspaceId),
    },
  ];
}

function getPlanningDashboardFilterHref(
  pathname: "/planning" | "/planning/projects",
  filter: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ filter });
  if (workspaceId) params.set("workspace", workspaceId);
  return `${pathname}?${params.toString()}`;
}

function getPlanningSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return `/planning/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/planning/sessions/${sessionId}?${params.toString()}`;
}

function hasProjectSetupIssue(entry: PlanningProjectOption): boolean {
  if (!entry.linkedRepository) return true;
  const discoveryStatus = entry.linkedRepository.discoveryStatus?.trim().toLowerCase();
  if (discoveryStatus?.includes("auth") || discoveryStatus?.includes("invalid")) return true;
  if (entry.linkedRepository.dirty) return true;

  const project = entry.project;
  if (!project) return true;
  if (project.planningProvider === "linear" && !project.linearProjectId) return true;
  return !hasConfiguredAutomation(project.automationSettings);
}

function hasConfiguredAutomation(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings) return false;

  return Object.values(settings).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== null && value !== undefined && value !== false && value !== "";
  });
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function normalizePlanningSessionTitle(title?: string | null): string {
  const normalized = title?.trim();
  return normalized || "Untitled planning session";
}

function normalizePlanningSessionProjectLabel(projectName?: string | null): string {
  const normalized = projectName?.trim();
  return normalized || "Planning";
}

function getPlanningSessionStatusTone(status?: string | null): PlanningDashboardSummaryTone {
  const normalized = status?.toLowerCase();
  if (normalized === "running" || normalized === "starting") return "success";
  if (
    normalized === "awaiting-input" ||
    normalized === "awaiting_input" ||
    normalized === "pending" ||
    normalized === "provisioning" ||
    normalized === "idle"
  ) {
    return "warning";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "interrupted") {
    return "danger";
  }
  return "default";
}

function formatPlanningSessionFilterTitle(filter: PlanningDashboardFilter): string {
  return filter === "awaiting-input" ? "Plans Needing Input" : "Drafts Awaiting Commit";
}

function formatPlanningSessionLastUpdatedLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  const time = timestampValue(value);
  const nowTime = now.getTime();
  if (!time || Number.isNaN(nowTime)) return "No activity";

  const diffMins = Math.max(0, Math.floor((nowTime - time) / 60_000));
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function orderPlanningSessionsByActivity<T extends PlanningDashboardSession>(
  sessions: T[],
): T[] {
  return [...sessions].sort(
    (left, right) => planningSessionActivityTime(right) - planningSessionActivityTime(left),
  );
}

function planningSessionActivityTime(session: PlanningDashboardSession): number {
  const value = session.updatedAt ?? session.createdAt;
  return timestampValue(value);
}

function timestampValue(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
