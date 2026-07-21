export interface RunningNowRunLike {
  id: string;
  status: string;
  title?: string | null;
  agentType?: string | null;
  workspaceId?: string | null;
  workItemId?: string | null;
  sessionId?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  lastActivityAt?: string | Date | null;
}

export interface RunningNowWorkItemLike {
  id: string;
  identifier: string;
  title: string;
  kind?: string | null;
  status: string;
  workspaceId?: string | null;
  updatedAt?: string | Date | null;
  agentStatus?: {
    sessionId: string;
    status: string;
    agentType?: string | null;
  } | null;
}

export type RunningNowRailStatusTone = "success" | "warning" | "danger" | "default";

export interface RunningNowRailRow {
  id: string;
  title: string;
  statusLabel: string;
  statusTone: RunningNowRailStatusTone;
  agentLabel: string;
  lastUpdatedLabel: string;
  href: string;
}

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "starting",
  "provisioning",
  "pending",
  "awaiting-input",
  "awaiting_input",
  // Paused awaiting a human decision — still active (the "needs you" state).
  "blocked",
  // Lease expired: contact lost, process fate unknown — still active.
  "host_unknown",
]);
const ACTIVE_WORK_STATUSES = new Set(["in_progress", "running"]);
const ACTIVE_AGENT_STATUSES = ACTIVE_RUN_STATUSES;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORK_ITEM_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export function filterRunningNowRuns<T extends RunningNowRunLike>(runs: T[]): T[] {
  return runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

export function filterRunningNowWorkItems<T extends RunningNowWorkItemLike>(items: T[]): T[] {
  return items.filter((item) => {
    if (item.kind && item.kind !== "task") return false;
    if (ACTIVE_WORK_STATUSES.has(item.status)) return true;
    return item.agentStatus ? ACTIVE_AGENT_STATUSES.has(item.agentStatus.status) : false;
  });
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getRunningNowRunHref(
  run: RunningNowRunLike,
  workspaceId?: string | null,
): string {
  const scopedWorkspaceId = workspaceId ?? run.workspaceId;

  if (
    run.workItemId &&
    (UUID_PATTERN.test(run.workItemId) || WORK_ITEM_IDENTIFIER_PATTERN.test(run.workItemId))
  ) {
    return appendWorkspaceParam(`/work-items/${run.workItemId}?view=outcome`, scopedWorkspaceId);
  }

  if (run.sessionId) {
    return appendWorkspaceParam(`/sessions/${run.sessionId}`, scopedWorkspaceId);
  }

  return appendWorkspaceParam(`/runs/${run.id}`, scopedWorkspaceId);
}

export function buildRunningNowRailRows(input: {
  runs: RunningNowRunLike[];
  workItems?: RunningNowWorkItemLike[];
  workspaceId?: string | null;
  now?: Date;
  limit?: number;
}): RunningNowRailRow[] {
  const now = input.now ?? new Date();
  const activeWorkItems = filterRunningNowWorkItems(input.workItems ?? []);
  const activeWorkItemIds = new Set(activeWorkItems.map((item) => item.id));
  const activeWorkItemSessionIds = new Set(
    activeWorkItems.flatMap((item) =>
      item.agentStatus?.sessionId ? [item.agentStatus.sessionId] : [],
    ),
  );
  const workItemRows = activeWorkItems.map((item) => ({
    row: buildRunningNowWorkItemRow(item, input.workspaceId, now),
    timestamp: timestampValue(item.updatedAt),
  }));

  const runRows = filterRunningNowRuns(input.runs)
    .filter((run) => {
      if (run.workItemId && activeWorkItemIds.has(run.workItemId)) return false;
      if (run.sessionId && activeWorkItemSessionIds.has(run.sessionId)) return false;
      return true;
    })
    .map((run) => ({
      row: {
        id: run.id,
        title: formatRunTitle(run),
        statusLabel: formatStatusLabel(run.status),
        statusTone: getStatusTone(run.status),
        agentLabel: formatAgentLabel(run.agentType ?? "Agent"),
        lastUpdatedLabel: formatLastUpdatedLabel(
          run.lastActivityAt ?? run.updatedAt ?? run.createdAt,
          now,
        ),
        href: getRunningNowRunHref(run, input.workspaceId),
      } satisfies RunningNowRailRow,
      timestamp: timestampValue(run.lastActivityAt ?? run.updatedAt ?? run.createdAt),
    }));

  return [...workItemRows, ...runRows]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, input.limit ?? 8)
    .map((entry) => entry.row);
}

function buildRunningNowWorkItemRow(
  item: RunningNowWorkItemLike,
  workspaceId: string | null | undefined,
  now: Date,
): RunningNowRailRow {
  const status = item.agentStatus && ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
    ? item.agentStatus.status
    : item.status;

  return {
    id: `work-item:${item.id}`,
    title: `${item.identifier} · ${item.title}`,
    statusLabel: formatStatusLabel(status),
    statusTone: getStatusTone(status),
    agentLabel: formatAgentLabel(item.agentStatus?.agentType ?? "Task"),
    lastUpdatedLabel: formatLastUpdatedLabel(item.updatedAt, now),
    href: appendWorkspaceParam(
      `/work-items/${item.id}?view=outcome`,
      workspaceId ?? item.workspaceId,
    ),
  };
}

function formatRunTitle(run: RunningNowRunLike): string {
  const title = run.title?.trim();
  if (title) return title;
  if (run.agentType) return formatAgentTitle(run.agentType);
  return run.id.slice(0, 8);
}

function formatAgentTitle(value: string): string {
  return value
    .trim()
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatAgentLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";

  return formatAgentTitle(normalized);
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getStatusTone(status: string): RunningNowRailStatusTone {
  if (status === "running" || status === "in_progress") return "success";
  // Lease expired: contact lost — muted/neutral "lost contact", not the
  // amber "needs you" of a blocked run.
  if (status === "host_unknown") return "default";
  if (ACTIVE_RUN_STATUSES.has(status)) return "warning";
  return "default";
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
