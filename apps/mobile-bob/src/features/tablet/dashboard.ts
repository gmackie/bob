import { buildExecutionQueue, formatStatusLabel } from "./queue";
import type { TabletQueueItem } from "./queue";

export type ProviderKey = "codex" | "cursor";
export type DashboardTone = "default" | "warning" | "danger" | "success";

export interface TabletDashboardSession {
  sessionId: string;
  status: string;
  agentType: string;
  lastActivityAt: string;
  title?: string | null;
  workItemId?: string | null;
}

export type TabletDashboardWorkItem = TabletQueueItem;

export interface ProviderDetailRun {
  id: string;
  status: string;
  agentType?: string | null;
  workItemId?: string | null;
  sessionId?: string | null;
  lastActivityAt?: string | Date | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  createdAt?: string | Date | null;
  session?: {
    title?: string | null;
  } | null;
}

export interface ProviderRunRowModel {
  title: string;
  statusLabel: string;
  statusTone: DashboardTone;
  agentLabel: string;
  lastUpdatedLabel: string;
  accessibilityLabel: string;
}

export type ProviderRunSectionKey = "active" | "failed" | "completed" | "other";

export interface ProviderRunSectionModel<T extends ProviderDetailRun> {
  key: ProviderRunSectionKey;
  title: string;
  emptyLabel: string;
  count: number;
  runs: T[];
  rows: Array<ProviderRunRowModel & { id: string; run: T }>;
}

export interface TaskDashboardHeaderModel {
  title: "Tasks";
  subtitle: null;
}

export type ProviderRunTarget =
  | { type: "work-item"; workItemId: string; view: "outcome" }
  | { type: "execution-session"; sessionId: string }
  | { type: "none" };

export type RunningNowWorkItemTarget = {
  workItemId: string;
  view: "queue" | "outcome";
};

export type RunningNowEntryTarget =
  | { type: "work-item"; workItemId: string; view: "outcome" }
  | { type: "execution-session"; sessionId: string };

export interface RunningNowEntry {
  id: string;
  title: string;
  statusLabel: string;
  detailLabel: string;
  lastUpdatedLabel: string;
  accessibilityLabel: string;
  target: RunningNowEntryTarget;
}

export interface RecentOutcomeRowModel {
  status: string;
  statusLabel: string;
  badgeVariant: "accent" | "danger";
  agentLabel: string;
  lastUpdatedLabel: string;
  accessibilityLabel: string;
}

export interface RecentlyCompletedRowModel {
  status: string;
  statusLabel: string;
  badgeVariant: "accent" | "danger";
}

export interface ProviderRunGroups<T extends ProviderDetailRun> {
  active: T[];
  failed: T[];
  completed: T[];
  other: T[];
  metrics: {
    total: number;
    active: number;
    failed: number;
    completed: number;
  };
}

export type ProviderRunsScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

export interface ProviderCapacityCard {
  provider: ProviderKey;
  label: string;
  activeCount: number;
  queuedOrStartingCount: number;
  limitLabel: string;
  statusLabel: string;
  tone: DashboardTone;
  usageLimits: ProviderUsageLimit[];
}

export interface ProviderUsageLimit {
  label: string;
  remainingPercent: number | null;
  usedPercent?: number | null;
  barPercent?: number;
  valueLabel?: string;
  resetLabel: string | null;
}

export interface ProviderCapacitySnapshot {
  provider: ProviderKey;
  usageLimits: ProviderUsageLimit[];
}

export interface ProviderCapacityRunSummary {
  id: string;
  agentType?: string | null;
  summary?: unknown;
}

export interface TaskLaneSummary {
  key: "needs-attention" | "ready" | "active" | "review";
  title: string;
  count: number;
  tone: DashboardTone;
}

export type TaskLaneKey = TaskLaneSummary["key"];
export interface TaskLaneRowModel {
  status: string;
  statusLabel: string;
}
export type TabletDashboardSectionKey = "summary-boxes" | "recently-completed";
export interface TaskDashboardLayout {
  showRightRail: boolean;
  liveRailPresentation: "rail" | "sheet";
  laneWrap: "wrap" | "nowrap";
  laneCardMinWidth: number;
  providerFooterDirection: "row" | "column";
}

const TABLET_DASHBOARD_SECTION_ORDER: TabletDashboardSectionKey[] = [
  "summary-boxes",
  "recently-completed",
];

const ACTIVE_SESSION_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);
const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);
const COMPLETED_RUN_STATUSES = new Set(["completed", "done", "stopped", "idle"]);
const FAILED_RUN_STATUSES = new Set(["failed", "error", "interrupted", "cancelled", "canceled"]);
const REVIEW_RUN_STATUSES = new Set(["in_review", "review"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORK_ITEM_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const STARTING_SESSION_STATUSES = new Set(["starting", "provisioning", "pending"]);
const FAILED_SESSION_STATUSES = new Set(["error", "failed", "interrupted"]);
const QUEUED_WORK_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const REVIEW_WORK_STATUSES = new Set(["in_review", "review"]);
const BLOCKED_WORK_STATUSES = new Set(["blocked"]);
const FAILED_WORK_STATUSES = new Set(["error", "failed", "interrupted"]);
const ACTIVE_WORK_STATUSES = new Set(["in_progress", "running"]);
const DONE_WORK_STATUSES = new Set(["done", "completed", "cancelled", "canceled", "stopped"]);
const ACTIVE_AGENT_WORK_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);
const FAILED_AGENT_WORK_STATUSES = new Set(["error", "failed", "interrupted"]);
const WORK_ITEM_OUTCOME_STATUSES = new Set([
  ...DONE_WORK_STATUSES,
  ...FAILED_WORK_STATUSES,
  ...REVIEW_WORK_STATUSES,
]);
const TERMINAL_AGENT_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "error",
  "failed",
  "interrupted",
  "stopped",
]);
const COMPLETED_AGENT_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "stopped",
]);

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

function getProvider(agentType: string): ProviderKey {
  return agentType.toLowerCase().includes("cursor") ? "cursor" : "codex";
}

export function normalizeProviderKey(value: string | string[] | undefined): ProviderKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "cursor" ? "cursor" : "codex";
}

export function getTaskDashboardHeaderModel(): TaskDashboardHeaderModel {
  return {
    title: "Tasks",
    subtitle: null,
  };
}

export function getProviderRunsScope(workspaceId?: string | null): ProviderRunsScope {
  return workspaceId ? { mode: "workspace", workspaceId } : { mode: "all" };
}

export function filterProviderRuns<T extends { agentType?: string | null }>(
  runs: T[],
  provider: ProviderKey,
): T[] {
  return runs.filter((run) => getProvider(run.agentType ?? "codex") === provider);
}

export function buildProviderRunGroups<T extends ProviderDetailRun>(
  runs: T[],
): ProviderRunGroups<T> {
  const groups: ProviderRunGroups<T> = {
    active: [],
    failed: [],
    completed: [],
    other: [],
    metrics: {
      total: runs.length,
      active: 0,
      failed: 0,
      completed: 0,
    },
  };

  for (const run of runs) {
    if (ACTIVE_RUN_STATUSES.has(run.status)) {
      groups.active.push(run);
    } else if (FAILED_RUN_STATUSES.has(run.status)) {
      groups.failed.push(run);
    } else if (COMPLETED_RUN_STATUSES.has(run.status)) {
      groups.completed.push(run);
    } else {
      groups.other.push(run);
    }
  }

  groups.metrics.active = groups.active.length;
  groups.metrics.failed = groups.failed.length;
  groups.metrics.completed = groups.completed.length;

  return groups;
}

export function buildProviderRunSectionModels<T extends ProviderDetailRun>(
  runs: T[],
  options: { now?: Date; includeEmptyOther?: boolean } = {},
): Array<ProviderRunSectionModel<T>> {
  const groups = buildProviderRunGroups(runs);
  const sections: Array<{
    key: ProviderRunSectionKey;
    title: string;
    emptyLabel: string;
    runs: T[];
  }> = [
    {
      key: "active",
      title: "Active Sessions",
      emptyLabel: "No active sessions for this provider.",
      runs: groups.active,
    },
    {
      key: "failed",
      title: "Failed Tasks",
      emptyLabel: "No failed task runs for this provider.",
      runs: groups.failed,
    },
    {
      key: "completed",
      title: "Completed Tasks",
      emptyLabel: "No completed task runs for this provider.",
      runs: groups.completed,
    },
    {
      key: "other",
      title: "Other History",
      emptyLabel: "No other provider history.",
      runs: groups.other,
    },
  ];

  return sections
    .filter((section) => section.key !== "other" || options.includeEmptyOther || section.runs.length > 0)
    .map((section) => ({
      key: section.key,
      title: section.title,
      emptyLabel: section.emptyLabel,
      count: section.runs.length,
      runs: section.runs,
      rows: section.runs.map((run) => ({
        id: run.id,
        run,
        ...buildProviderRunRowModel(run, { now: options.now }),
      })),
    }));
}

export function formatProviderRunTitle(run: ProviderDetailRun): string {
  const sessionTitle = run.session?.title?.trim();
  if (sessionTitle) return sessionTitle;
  if (run.workItemId) return run.workItemId;
  return run.id;
}

export function buildProviderRunRowModel(
  run: ProviderDetailRun,
  options: { now?: Date } = {},
): ProviderRunRowModel {
  const title = formatProviderRunTitle(run);
  const statusLabel = formatStatusLabel(run.status);
  const agentLabel = formatProviderAgentLabel(run.agentType);
  const lastUpdatedLabel = formatRelativeActivityLabel(
    run.lastActivityAt ?? run.updatedAt ?? run.completedAt ?? run.createdAt,
    options.now ?? new Date(),
  );

  return {
    title,
    statusLabel,
    statusTone: getProviderRunStatusTone(run.status),
    agentLabel,
    lastUpdatedLabel,
    accessibilityLabel: `${title}, ${statusLabel}, ${agentLabel}, ${lastUpdatedLabel}`,
  };
}

export function getProviderRunHref(
  run: ProviderDetailRun,
  workspaceId?: string | null,
): string {
  if (isResolvableWorkItemReference(run.workItemId)) {
    return appendWorkspaceParam(`/work-items/${run.workItemId}?view=outcome`, workspaceId);
  }

  return appendWorkspaceParam(`/runs/${run.id}`, workspaceId);
}

export function getMobileProviderRunHref(
  run: ProviderDetailRun,
  workspaceId?: string | null,
): string | null {
  const target = getProviderRunTarget(run);

  if (target.type === "work-item") {
    return appendWorkspaceParam(`/work-items/${target.workItemId}?view=${target.view}`, workspaceId);
  }

  if (target.type === "execution-session") {
    return appendWorkspaceParam(`/sessions/${target.sessionId}`, workspaceId);
  }

  return null;
}

export function getProviderRunTarget(run: ProviderDetailRun): ProviderRunTarget {
  if (run.sessionId && ACTIVE_RUN_STATUSES.has(run.status)) {
    return {
      type: "execution-session",
      sessionId: run.sessionId,
    };
  }

  if (isResolvableWorkItemReference(run.workItemId)) {
    return {
      type: "work-item",
      workItemId: run.workItemId,
      view: "outcome",
    };
  }

  if (run.sessionId) {
    return {
      type: "execution-session",
      sessionId: run.sessionId,
    };
  }

  return { type: "none" };
}

function isResolvableWorkItemReference(value: string | null | undefined): value is string {
  return Boolean(value && (UUID_PATTERN.test(value) || WORK_ITEM_IDENTIFIER_PATTERN.test(value)));
}

function getProviderRunStatusTone(status: string): DashboardTone {
  if (FAILED_RUN_STATUSES.has(status)) return "danger";
  if (REVIEW_RUN_STATUSES.has(status)) return "warning";
  if (ACTIVE_RUN_STATUSES.has(status)) return "warning";
  if (COMPLETED_RUN_STATUSES.has(status)) return "success";
  return "default";
}

function formatProviderAgentLabel(agentType?: string | null): string {
  const normalized = agentType?.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";

  return normalized
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRelativeActivityLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  const timestamp = timestampValue(value);
  if (!Number.isFinite(timestamp)) return "No activity";

  const diffMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timestampValue(value: string | Date | null | undefined): number {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function buildProviderCard(
  provider: ProviderKey,
  sessions: TabletDashboardSession[],
  queuedCount: number,
  snapshot?: ProviderCapacitySnapshot | null,
): ProviderCapacityCard {
  const matchingSessions = sessions.filter(
    (session) => getProvider(session.agentType) === provider,
  );
  const activeCount = matchingSessions.filter((session) =>
    ACTIVE_SESSION_STATUSES.has(session.status),
  ).length;
  const startingCount = matchingSessions.filter((session) =>
    STARTING_SESSION_STATUSES.has(session.status),
  ).length;
  const hasFailure = matchingSessions.some((session) =>
    FAILED_SESSION_STATUSES.has(session.status),
  );
  const usageLimits = snapshot?.usageLimits ?? getDefaultProviderUsageLimits(provider);

  return {
    provider,
    label: provider === "codex" ? "Codex" : "Cursor",
    activeCount,
    queuedOrStartingCount: startingCount + (provider === "codex" ? queuedCount : 0),
    limitLabel: snapshot ? "Capacity connected" : "Capacity not connected",
    statusLabel: hasFailure ? "Recent failure" : "Normal",
    tone: hasFailure ? "danger" : activeCount > 0 ? "success" : "default",
    usageLimits,
  };
}

export function buildProviderCapacityCards(input: {
  sessions: TabletDashboardSession[];
  workItems: TabletDashboardWorkItem[];
  capacitySnapshots?: ProviderCapacitySnapshot[];
}): ProviderCapacityCard[] {
  const queuedCount = input.workItems.filter((item) =>
    item.kind === "task" && QUEUED_WORK_STATUSES.has(item.status),
  ).length;
  const snapshots = new Map(
    (input.capacitySnapshots ?? []).map((snapshot) => [snapshot.provider, snapshot]),
  );

  return [
    buildProviderCard("codex", input.sessions, queuedCount, snapshots.get("codex")),
    buildProviderCard("cursor", input.sessions, queuedCount, snapshots.get("cursor")),
  ];
}

export function getProviderCapacityStatusLine(card: ProviderCapacityCard): string {
  return `${card.limitLabel} · ${card.statusLabel}`;
}

export function extractProviderCapacitySnapshotsFromRuns(
  runs: ProviderCapacityRunSummary[],
): ProviderCapacitySnapshot[] {
  const snapshots = new Map<ProviderKey, ProviderCapacitySnapshot>();

  for (const run of runs) {
    const provider = getProvider(run.agentType ?? "codex");
    if (snapshots.has(provider)) continue;

    const usageLimits = parseProviderUsageLimits(run.summary);
    if (usageLimits.length > 0) {
      snapshots.set(provider, { provider, usageLimits });
    }
  }

  return Array.from(snapshots.values());
}

function parseProviderUsageLimits(summary: unknown): ProviderUsageLimit[] {
  if (!summary || typeof summary !== "object") return [];
  const capacity = (summary as { providerCapacity?: unknown }).providerCapacity;
  if (!capacity || typeof capacity !== "object") return [];
  const usageLimits = (capacity as { usageLimits?: unknown }).usageLimits;
  if (!Array.isArray(usageLimits)) return [];

  return usageLimits.flatMap((limit) => {
    if (!limit || typeof limit !== "object") return [];
    const candidate = limit as {
      label?: unknown;
      remainingPercent?: unknown;
      usedPercent?: unknown;
      valueLabel?: unknown;
      resetLabel?: unknown;
    };
    if (typeof candidate.label !== "string") return [];

    return [buildProviderUsageLimit({
      label: candidate.label,
      remainingPercent: candidate.remainingPercent,
      usedPercent: candidate.usedPercent,
      valueLabel: candidate.valueLabel,
      resetLabel: candidate.resetLabel,
    })];
  });
}

function buildProviderUsageLimit(input: {
  label: string;
  remainingPercent?: unknown;
  usedPercent?: unknown;
  valueLabel?: unknown;
  resetLabel?: unknown;
}): ProviderUsageLimit {
  const remainingPercent =
    typeof input.remainingPercent === "number"
      ? clampPercent(input.remainingPercent)
      : null;
  const usedPercent =
    typeof input.usedPercent === "number"
      ? clampPercent(input.usedPercent)
      : null;
  const valueLabel =
    typeof input.valueLabel === "string" && input.valueLabel.trim()
      ? input.valueLabel.trim()
      : usedPercent !== null
        ? `${usedPercent}% used`
        : remainingPercent !== null
          ? `${remainingPercent}% remaining`
          : "Unavailable";

  return {
    label: input.label,
    remainingPercent,
    usedPercent,
    barPercent: usedPercent ?? remainingPercent ?? 0,
    valueLabel,
    resetLabel:
      typeof input.resetLabel === "string" ? input.resetLabel : null,
  };
}

function getDefaultProviderUsageLimits(provider: ProviderKey): ProviderUsageLimit[] {
  return provider === "codex"
    ? [
        buildProviderUsageLimit({
          label: "5 hour usage limit",
          remainingPercent: null,
          resetLabel: null,
        }),
        buildProviderUsageLimit({
          label: "Weekly usage limit",
          remainingPercent: null,
          resetLabel: null,
        }),
      ]
    : [
        buildProviderUsageLimit({
          label: "Included usage",
          remainingPercent: null,
          resetLabel: null,
        }),
        buildProviderUsageLimit({
          label: "On-demand spend",
          remainingPercent: null,
          resetLabel: null,
        }),
      ];
}

export function buildTaskLaneSummaries(
  workItems: TabletDashboardWorkItem[],
): TaskLaneSummary[] {
  const needsAttention = filterTaskLaneWorkItems(workItems, "needs-attention");
  const ready = filterTaskLaneWorkItems(workItems, "ready");
  const active = filterTaskLaneWorkItems(workItems, "active");
  const review = filterTaskLaneWorkItems(workItems, "review");

  return [
    {
      key: "needs-attention",
      title: "Needs Attention",
      count: needsAttention.length,
      tone: needsAttention.length > 0 ? "danger" : "default",
    },
    {
      key: "ready",
      title: "Ready",
      count: ready.length,
      tone: ready.length > 0 ? "success" : "default",
    },
    {
      key: "active",
      title: "Active",
      count: active.length,
      tone: active.length > 0 ? "success" : "default",
    },
    {
      key: "review",
      title: "Review",
      count: review.length,
      tone: review.length > 0 ? "warning" : "default",
    },
  ];
}

export function getTaskDashboardLayout(screenWidth: number): TaskDashboardLayout {
  const showRightRail = screenWidth >= 980;

  return {
    showRightRail,
    liveRailPresentation: showRightRail ? "rail" : "sheet",
    laneWrap: showRightRail ? "nowrap" : "wrap",
    laneCardMinWidth: showRightRail ? 0 : 132,
    providerFooterDirection: showRightRail ? "column" : "row",
  };
}

export function getTabletDashboardSectionOrder(): TabletDashboardSectionKey[] {
  return [...TABLET_DASHBOARD_SECTION_ORDER];
}

export function filterTaskLaneWorkItems(
  workItems: TabletDashboardWorkItem[],
  lane: TaskLaneKey,
): TabletDashboardWorkItem[] {
  const ordered = buildExecutionQueue(workItems).filter((item) => item.kind === "task");

  switch (lane) {
    case "needs-attention":
      return ordered.filter((item) => {
        if (BLOCKED_WORK_STATUSES.has(item.status)) return true;
        if (FAILED_WORK_STATUSES.has(item.status)) return true;
        return item.agentStatus ? FAILED_AGENT_WORK_STATUSES.has(item.agentStatus.status) : false;
      });
    case "ready":
      return ordered.filter(
        (item) =>
          QUEUED_WORK_STATUSES.has(item.status) &&
          !(item.agentStatus && ACTIVE_AGENT_WORK_STATUSES.has(item.agentStatus.status)) &&
          !(item.agentStatus && FAILED_AGENT_WORK_STATUSES.has(item.agentStatus.status)),
      );
    case "active":
      return ordered.filter((item) => {
        if (ACTIVE_WORK_STATUSES.has(item.status)) return true;
        return item.agentStatus ? ACTIVE_AGENT_WORK_STATUSES.has(item.agentStatus.status) : false;
      });
    case "review":
      return ordered.filter((item) => REVIEW_WORK_STATUSES.has(item.status));
  }
}

export function getTaskLaneRowModel(
  workItem: TabletDashboardWorkItem,
  lane: TaskLaneKey,
): TaskLaneRowModel {
  const status = getTaskLaneRowStatus(workItem, lane);

  return {
    status,
    statusLabel: formatStatusLabel(status),
  };
}

function getTaskLaneRowStatus(
  workItem: TabletDashboardWorkItem,
  lane: TaskLaneKey,
): string {
  if (
    lane === "needs-attention" &&
    workItem.agentStatus &&
    FAILED_AGENT_WORK_STATUSES.has(workItem.agentStatus.status)
  ) {
    return workItem.agentStatus.status;
  }

  if (
    lane === "active" &&
    workItem.agentStatus &&
    ACTIVE_AGENT_WORK_STATUSES.has(workItem.agentStatus.status)
  ) {
    return workItem.agentStatus.status;
  }

  return workItem.status;
}

export function buildRecentlyCompletedWorkItems(
  workItems: TabletDashboardWorkItem[],
  limit = 5,
): TabletDashboardWorkItem[] {
  return workItems
    .filter((item) => item.kind === "task" && isRecentlyCompletedWorkItem(item))
    .sort((left, right) => completionTime(right) - completionTime(left))
    .slice(0, limit);
}

export function getRecentlyCompletedRowModel(
  workItem: TabletDashboardWorkItem,
): RecentlyCompletedRowModel {
  const status = getRecentlyCompletedWorkItemStatus(workItem);

  return {
    status,
    statusLabel: formatStatusLabel(status),
    badgeVariant: "accent",
  };
}

export function buildRecentOutcomeWorkItems(
  workItems: TabletDashboardWorkItem[],
  limit = 8,
): TabletDashboardWorkItem[] {
  return workItems
    .filter((item) => {
      if (item.kind !== "task") return false;
      if (DONE_WORK_STATUSES.has(item.status)) return true;
      if (FAILED_WORK_STATUSES.has(item.status)) return true;
      if (REVIEW_WORK_STATUSES.has(item.status)) return true;
      return item.agentStatus ? TERMINAL_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status) : false;
    })
    .sort((left, right) => completionTime(right) - completionTime(left))
    .slice(0, limit);
}

export function getRecentOutcomeWorkItemStatus(
  workItem: TabletDashboardWorkItem,
): string {
  const agentStatus = workItem.agentStatus?.status;
  if (
    !WORK_ITEM_OUTCOME_STATUSES.has(workItem.status) &&
    agentStatus &&
    TERMINAL_AGENT_OUTCOME_STATUSES.has(agentStatus)
  ) {
    return agentStatus;
  }

  return workItem.status;
}

export function getRecentOutcomeRowModel(
  workItem: TabletDashboardWorkItem,
  options: { now?: Date } = {},
): RecentOutcomeRowModel {
  const status = getRecentOutcomeWorkItemStatus(workItem);
  const statusLabel = formatStatusLabel(status);
  const now = options.now ?? new Date();

  return {
    status,
    statusLabel,
    badgeVariant:
      status === "failed" || status === "error" || status === "interrupted"
        ? "danger"
        : "accent",
    agentLabel: workItem.agentStatus?.agentType ?? workItem.kind,
    lastUpdatedLabel: formatLastUpdatedLabel(workItem.completedAt ?? workItem.updatedAt, now),
    accessibilityLabel: `${workItem.identifier} ${workItem.title}, ${statusLabel}`,
  };
}

export function buildActiveWorkItems(
  workItems: TabletDashboardWorkItem[],
  limit = 8,
): TabletDashboardWorkItem[] {
  return buildExecutionQueue(workItems)
    .filter((item) => {
      if (item.kind !== "task") return false;
      if (ACTIVE_WORK_STATUSES.has(item.status)) return true;
      return item.agentStatus ? ACTIVE_AGENT_WORK_STATUSES.has(item.agentStatus.status) : false;
    })
    .slice(0, limit);
}

export function buildRunningNowEntries(input: {
  workItems: TabletDashboardWorkItem[];
  sessions: TabletDashboardSession[];
  now?: Date;
  limit?: number;
}): RunningNowEntry[] {
  const now = input.now ?? new Date();
  const activeWorkItems = buildActiveWorkItems(input.workItems, Number.MAX_SAFE_INTEGER);
  const activeWorkItemIds = new Set(activeWorkItems.map((item) => item.id));
  const workItemEntries = activeWorkItems.map((item) => {
    const status = getTaskLaneRowStatus(item, "active");
    const title = `${item.identifier} · ${item.title}`;
    const lastUpdatedLabel = formatLastUpdatedLabel(item.updatedAt, now);
    const detailLabel = item.agentStatus?.agentType ?? item.kind;

    return {
      entry: {
        id: `work-item:${item.id}`,
        title,
        statusLabel: formatStatusLabel(status),
        detailLabel,
        lastUpdatedLabel,
        accessibilityLabel: `${title}, ${formatStatusLabel(status)}, ${detailLabel}, updated ${lastUpdatedLabel}`,
        target: {
          type: "work-item",
          workItemId: item.id,
          view: "outcome",
        },
      } satisfies RunningNowEntry,
      timestamp: completionTime(item),
    };
  });
  const sessionEntries = input.sessions
    .filter((session) => {
      if (!ACTIVE_SESSION_STATUSES.has(session.status)) return false;
      return !session.workItemId || !activeWorkItemIds.has(session.workItemId);
    })
    .map((session) => {
      const title = session.title?.trim() || session.agentType || session.sessionId;
      const statusLabel = formatStatusLabel(session.status);
      const lastUpdatedLabel = formatLastUpdatedLabel(session.lastActivityAt, now);

      return {
        entry: {
          id: `session:${session.sessionId}`,
          title,
          statusLabel,
          detailLabel: session.agentType,
          lastUpdatedLabel,
          accessibilityLabel: `${title}, ${statusLabel}, ${session.agentType}, updated ${lastUpdatedLabel}`,
          target: {
            type: "execution-session",
            sessionId: session.sessionId,
          },
        } satisfies RunningNowEntry,
        timestamp: timestampValue(session.lastActivityAt),
      };
    });

  return [...workItemEntries, ...sessionEntries]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, input.limit ?? 8)
    .map((row) => row.entry);
}

export function getRunningNowWorkItemTarget(
  workItem: TabletDashboardWorkItem,
): RunningNowWorkItemTarget {
  return {
    workItemId: workItem.id,
    view: "outcome",
  };
}

export function getTaskLaneWorkItemTarget(
  workItem: TabletDashboardWorkItem,
  lane: TaskLaneKey,
): RunningNowWorkItemTarget {
  if (lane === "active" || lane === "review") {
    return {
      workItemId: workItem.id,
      view: "outcome",
    };
  }

  if (
    lane === "needs-attention" &&
    (FAILED_WORK_STATUSES.has(workItem.status) ||
      (workItem.agentStatus && FAILED_AGENT_WORK_STATUSES.has(workItem.agentStatus.status)))
  ) {
    return {
      workItemId: workItem.id,
      view: "outcome",
    };
  }

  return {
    workItemId: workItem.id,
    view: "queue",
  };
}

function completionTime(item: TabletDashboardWorkItem): number {
  const value = item.completedAt ?? item.updatedAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function isRecentlyCompletedWorkItem(item: TabletDashboardWorkItem): boolean {
  if (DONE_WORK_STATUSES.has(item.status)) return true;
  return item.agentStatus
    ? COMPLETED_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status)
    : false;
}

function getRecentlyCompletedWorkItemStatus(
  workItem: TabletDashboardWorkItem,
): string {
  const agentStatus = workItem.agentStatus?.status;
  if (
    !DONE_WORK_STATUSES.has(workItem.status) &&
    agentStatus &&
    COMPLETED_AGENT_OUTCOME_STATUSES.has(agentStatus)
  ) {
    return agentStatus;
  }

  return workItem.status;
}

function formatLastUpdatedLabel(
  value: string | Date | null | undefined,
  now: Date,
): string {
  if (!value) return "No activity";
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "No activity";

  const diffMs = Math.max(0, now.getTime() - timestamp);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
