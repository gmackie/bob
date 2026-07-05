import {
  buildShellSessionRows,
  groupShellSessions,
} from "./shell";
import type {
  TabletShellSession,
  TabletShellStatusTone,
} from "./shell";

export interface TabletPlanningProject {
  project: {
    id: string;
    name?: string | null;
    planningProvider?: string | null;
    linearProjectId?: string | null;
    automationSettings?: Record<string, unknown> | null;
  };
  linkedRepository?: {
    path?: string | null;
    dirty?: boolean | null;
    stale?: boolean | null;
    discoveryStatus?: string | null;
  } | null;
}

export type TabletPlanningDashboardSummaryTone = "default" | "warning" | "danger" | "success";
export type TabletPlanningDashboardFilter = "drafts" | "awaiting-input";

export interface TabletPlanningDashboardSummaryCard {
  key:
    | "drafts-awaiting-commit"
    | "plans-needing-input"
    | "project-setup-issues"
    | "stale-project-sync"
    | "healthy-projects";
  title: string;
  count: number;
  tone: TabletPlanningDashboardSummaryTone;
  target: TabletPlanningSummaryTarget;
}

export interface TabletPlanningDashboardModel<TSession extends TabletShellSession> {
  activeSessions: TSession[];
  recentSessions: TSession[];
  projectCount: number;
  connectedProjectCount: number;
  summaryCards: TabletPlanningDashboardSummaryCard[];
}

export interface TabletPlanningDashboardHeaderModel {
  title: "Planning";
  subtitle: null;
}

export interface TabletPlanningDashboardComposerAction {
  key: "start-planning-session" | "hide-planning-session";
  label: string;
  nextOpen: boolean;
}

export interface TabletPlanningDashboardSessionRow {
  sessionId: string;
  title: string;
  statusLabel: string;
  statusTone: TabletShellStatusTone;
  outputLabel: string;
  lastUpdatedLabel: string;
}

export interface TabletPlanningDashboardNavigationAction {
  key: "recent-sessions" | "projects";
  label: string;
  href: "/planning" | "/projects";
}

export type TabletPlanningSummaryTarget =
  | { type: "planning-dashboard"; filter: "drafts" | "awaiting-input" }
  | { type: "projects-dashboard"; filter: "setup-issues" | "stale-sync" | "healthy" };

const AWAITING_INPUT_STATUSES = new Set(["awaiting-input", "awaiting_input"]);
const INLINE_ACTIVE_RAIL_MIN_WIDTH = 980;

export function shouldShowPlanningActiveRailInline(width: number): boolean {
  return width >= INLINE_ACTIVE_RAIL_MIN_WIDTH;
}

export function getPlanningLiveRailPresentation(width: number): "rail" | "sheet" {
  return shouldShowPlanningActiveRailInline(width) ? "rail" : "sheet";
}

export function shouldShowPlanningDashboardNavigationActions({
  hasModeSwitch = false,
  isEmbeddedInShell,
  width,
}: {
  hasModeSwitch?: boolean;
  isEmbeddedInShell: boolean;
  width: number;
}): boolean {
  if (hasModeSwitch) return false;
  if (isEmbeddedInShell) return false;
  return !shouldShowPlanningActiveRailInline(width);
}

export function shouldShowPlanningDashboardModeActions({
  hasModeSwitch,
  isEmbeddedInShell,
}: {
  hasModeSwitch: boolean;
  isEmbeddedInShell: boolean;
}): boolean {
  return hasModeSwitch && !isEmbeddedInShell;
}

export function getTabletPlanningDashboardHeaderModel(): TabletPlanningDashboardHeaderModel {
  return {
    title: "Planning",
    subtitle: null,
  };
}

export function getPlanningDashboardComposerAction(
  isComposerOpen: boolean,
): TabletPlanningDashboardComposerAction {
  return isComposerOpen
    ? { key: "hide-planning-session", label: "Hide", nextOpen: false }
    : { key: "start-planning-session", label: "+ Planning", nextOpen: true };
}

export function getPlanningDashboardNavigationActions(): TabletPlanningDashboardNavigationAction[] {
  return [
    { key: "recent-sessions", label: "Recent Sessions", href: "/planning" },
    { key: "projects", label: "Projects", href: "/projects" },
  ];
}

export function buildPlanningDashboardModel<TSession extends TabletShellSession>(input: {
  sessions: TSession[];
  projects: TabletPlanningProject[];
}): TabletPlanningDashboardModel<TSession> {
  const grouped = groupShellSessions(input.sessions);

  return {
    activeSessions: grouped.planningActive,
    recentSessions: grouped.recentPlanning,
    projectCount: input.projects.length,
    connectedProjectCount: input.projects.filter((entry) => Boolean(entry.linkedRepository)).length,
    summaryCards: buildPlanningDashboardSummaryCards(input),
  };
}

export function normalizeTabletPlanningDashboardFilter(
  value: string | null | undefined,
): TabletPlanningDashboardFilter | null {
  return value === "drafts" || value === "awaiting-input" ? value : null;
}

export function filterTabletPlanningDashboardSessions<TSession extends TabletShellSession>(
  sessions: TSession[],
  filter: string | null | undefined,
): TSession[] {
  const normalized = normalizeTabletPlanningDashboardFilter(filter ?? null);
  if (!normalized) return sessions;

  if (normalized === "drafts") {
    return sessions.filter((session) => normalizeCount(session.draftCount) > 0);
  }

  return sessions.filter((session) =>
    AWAITING_INPUT_STATUSES.has(session.status.toLowerCase()),
  );
}

export function formatTabletPlanningSessionOutputLabel(
  session: Pick<TabletShellSession, "draftCount" | "producedTaskCount">,
): string {
  const draftCount = normalizeCount(session.draftCount);
  const taskCount = normalizeCount(session.producedTaskCount);

  if (draftCount === 0 && taskCount === 0) return "No drafts";
  return [
    draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : null,
    taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" · ");
}

export function buildTabletPlanningDashboardSessionRows<TSession extends TabletShellSession>(
  sessions: TSession[],
  options: { now?: Date } = {},
): TabletPlanningDashboardSessionRow[] {
  return buildShellSessionRows(sessions, options).map((row) => ({
    sessionId: row.sessionId,
    title: row.title,
    statusLabel: row.statusLabel,
    statusTone: row.statusTone,
    outputLabel: formatTabletPlanningSessionOutputLabel(row.session),
    lastUpdatedLabel: row.lastUpdatedLabel,
  }));
}

function buildPlanningDashboardSummaryCards(input: {
  sessions: TabletShellSession[];
  projects: TabletPlanningProject[];
}): TabletPlanningDashboardSummaryCard[] {
  const draftCount = input.sessions.reduce(
    (total, session) => total + normalizeCount(session.draftCount),
    0,
  );
  const inputNeededCount = input.sessions.filter((session) =>
    AWAITING_INPUT_STATUSES.has(session.status.toLowerCase()),
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
      target: { type: "planning-dashboard", filter: "drafts" },
    },
    {
      key: "plans-needing-input",
      title: "Plans Needing Input",
      count: inputNeededCount,
      tone: inputNeededCount > 0 ? "warning" : "default",
      target: { type: "planning-dashboard", filter: "awaiting-input" },
    },
    {
      key: "project-setup-issues",
      title: "Setup Issues",
      count: setupIssueCount,
      tone: setupIssueCount > 0 ? "danger" : "default",
      target: { type: "projects-dashboard", filter: "setup-issues" },
    },
    {
      key: "stale-project-sync",
      title: "Stale Sync",
      count: staleProjectCount,
      tone: staleProjectCount > 0 ? "warning" : "default",
      target: { type: "projects-dashboard", filter: "stale-sync" },
    },
    {
      key: "healthy-projects",
      title: "Healthy Projects",
      count: healthyProjectCount,
      tone: healthyProjectCount > 0 ? "success" : "default",
      target: { type: "projects-dashboard", filter: "healthy" },
    },
  ];
}

function hasProjectSetupIssue(entry: TabletPlanningProject): boolean {
  if (!entry.linkedRepository) return true;
  const discoveryStatus = entry.linkedRepository.discoveryStatus?.trim().toLowerCase();
  if (discoveryStatus?.includes("auth") || discoveryStatus?.includes("invalid")) return true;
  if (entry.linkedRepository.dirty) return true;

  if (entry.project.planningProvider === "linear" && !entry.project.linearProjectId) {
    return true;
  }

  return !hasConfiguredAutomation(entry.project.automationSettings);
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

export function buildTabletPlanningSessionRequestInput(input: {
  workspaceId: string | null | undefined;
  projects: TabletPlanningProject[];
  goal: string;
}) {
  const goal = input.goal.trim();
  const project = input.projects[0]?.project ?? null;
  const projectName = project?.name?.trim() ?? "";

  if (!input.workspaceId || !project?.id || !projectName || !goal) {
    return null;
  }

  return {
    workspaceId: input.workspaceId,
    projectId: project.id,
    projectName,
    goal,
  };
}
