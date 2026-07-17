// Run-history providers are independent of work-pipeline capacity planning:
// Grok runs appear in Recent Outcomes but have no capacity model, so we keep a
// local key union here instead of widening work-pipeline-model's ProviderKey.
export type RunProviderKey = "claude" | "codex" | "cursor" | "grok";

export type ProviderRunFilter = RunProviderKey | "all";

export interface ProviderRunLike {
  id?: string;
  status?: string | null;
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

export interface ProviderRunGroups<T extends ProviderRunLike> {
  active: T[];
  completed: T[];
  failed: T[];
  other: T[];
  metrics: {
    total: number;
    active: number;
    completed: number;
    failed: number;
  };
}

export interface ProviderRunRowModel {
  title: string;
  href: string;
  statusLabel: string;
  statusTone: "default" | "success" | "warning" | "danger";
  agentLabel: string;
  lastUpdatedLabel: string;
  accessibilityLabel: string;
}

export interface ProviderRunsHeaderModel {
  title: string;
  subtitle: null;
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
const COMPLETED_RUN_STATUSES = new Set(["completed", "done", "stopped", "idle"]);
const FAILED_RUN_STATUSES = new Set(["failed", "error", "interrupted", "cancelled", "canceled"]);
const REVIEW_RUN_STATUSES = new Set(["in_review", "review"]);
const OUTCOME_RUN_STATUSES = new Set([
  ...COMPLETED_RUN_STATUSES,
  ...FAILED_RUN_STATUSES,
  ...REVIEW_RUN_STATUSES,
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORK_ITEM_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export function normalizeProviderParam(value: string | null): ProviderRunFilter {
  return value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "grok"
    ? value
    : "all";
}

export function getRunProvider(run: ProviderRunLike): RunProviderKey {
  const agentType = run.agentType?.toLowerCase() ?? "";
  if (agentType.includes("claude")) return "claude";
  if (agentType.includes("grok")) return "grok";
  if (agentType.includes("cursor")) return "cursor";
  return "codex";
}

export function filterRunsByProvider<T extends ProviderRunLike>(
  runs: T[],
  provider: ProviderRunFilter,
): T[] {
  if (provider === "all") return runs;
  return runs.filter((run) => getRunProvider(run) === provider);
}

export function getProviderRunsHeading(provider: ProviderRunFilter): string {
  if (provider === "claude") return "Claude Runs";
  if (provider === "codex") return "Codex Runs";
  if (provider === "cursor") return "Cursor Runs";
  if (provider === "grok") return "Grok Runs";
  return "Recent Outcomes";
}

export function getProviderRunsHeaderModel(
  provider: ProviderRunFilter,
): ProviderRunsHeaderModel {
  return {
    title: getProviderRunsHeading(provider),
    subtitle: null,
  };
}

export function getProviderRunsEmptyState(
  provider: ProviderRunFilter,
): ProviderRunsHeaderModel {
  return {
    title:
      provider === "all"
        ? "No recent outcomes yet"
        : `No ${provider} runs yet`,
    subtitle: null,
  };
}

export function filterRecentOutcomeRuns<T extends ProviderRunLike>(runs: T[]): T[] {
  return runs.filter((run) => OUTCOME_RUN_STATUSES.has(run.status ?? ""));
}

export function getProviderRunsFilterHref(
  currentSearch: string,
  updates: { provider?: ProviderRunFilter; workspaceId?: string | null },
): string {
  const current = new URLSearchParams(currentSearch);
  const provider = updates.provider ?? normalizeProviderParam(current.get("provider"));
  const workspaceId = updates.workspaceId === undefined
    ? current.get("workspace")
    : updates.workspaceId;
  const next = new URLSearchParams();

  if (provider !== "all") next.set("provider", provider);
  if (workspaceId) next.set("workspace", workspaceId);

  const query = next.toString();
  return query ? `/runs?${query}` : "/runs";
}

function appendWorkspaceParam(path: string, workspaceId?: string | null): string {
  if (!workspaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspace=${encodeURIComponent(workspaceId)}`;
}

export function getRunDetailBackHref(workspaceId?: string | null): string {
  return appendWorkspaceParam("/runs", workspaceId);
}

export function getRunDetailWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  return appendWorkspaceParam(`/work-items/${workItemId}?view=outcome`, workspaceId);
}

export function buildProviderRunGroups<T extends ProviderRunLike>(
  runs: T[],
): ProviderRunGroups<T> {
  const groups: ProviderRunGroups<T> = {
    active: [],
    completed: [],
    failed: [],
    other: [],
    metrics: {
      total: runs.length,
      active: 0,
      completed: 0,
      failed: 0,
    },
  };

  for (const run of runs) {
    const status = run.status ?? "";
    if (ACTIVE_RUN_STATUSES.has(status)) {
      groups.active.push(run);
    } else if (COMPLETED_RUN_STATUSES.has(status)) {
      groups.completed.push(run);
    } else if (FAILED_RUN_STATUSES.has(status)) {
      groups.failed.push(run);
    } else {
      groups.other.push(run);
    }
  }

  groups.metrics.active = groups.active.length;
  groups.metrics.completed = groups.completed.length;
  groups.metrics.failed = groups.failed.length;

  return groups;
}

export function formatProviderRunTitle(run: ProviderRunLike): string {
  const sessionTitle = run.session?.title?.trim();
  if (sessionTitle) return sessionTitle;
  if (run.workItemId) return run.workItemId;
  return run.id ?? "Untitled run";
}

export function getProviderRunHref(
  run: ProviderRunLike,
  workspaceId?: string | null,
): string {
  if (run.sessionId && ACTIVE_RUN_STATUSES.has(run.status ?? "")) {
    return appendWorkspaceParam(`/sessions/${run.sessionId}`, workspaceId);
  }

  if (
    run.workItemId &&
    (UUID_PATTERN.test(run.workItemId) || WORK_ITEM_IDENTIFIER_PATTERN.test(run.workItemId))
  ) {
    return getRunDetailWorkItemHref(run.workItemId, workspaceId);
  }

  if (run.sessionId) {
    return appendWorkspaceParam(`/sessions/${run.sessionId}`, workspaceId);
  }

  return appendWorkspaceParam(`/runs/${run.id ?? ""}`, workspaceId);
}

export function buildProviderRunRow(
  run: ProviderRunLike,
  workspaceId?: string | null,
  options: { now?: Date } = {},
): ProviderRunRowModel {
  const title = formatProviderRunTitle(run);
  const statusLabel = formatStatusLabel(run.status);
  const agentLabel = formatAgentLabel(run.agentType);
  const lastUpdatedLabel = formatLastUpdatedLabel(
    run.lastActivityAt ?? run.updatedAt ?? run.completedAt ?? run.createdAt,
    options.now ?? new Date(),
  );

  return {
    title,
    href: getProviderRunHref(run, workspaceId),
    statusLabel,
    statusTone: getRunStatusTone(run.status),
    agentLabel,
    lastUpdatedLabel,
    accessibilityLabel: `${title}, ${statusLabel}, ${agentLabel}, ${lastUpdatedLabel}`,
  };
}

function formatStatusLabel(status?: string | null): string {
  if (!status) return "Unknown";
  return status
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRunStatusTone(
  status?: string | null,
): ProviderRunRowModel["statusTone"] {
  const normalized = status ?? "";
  if (FAILED_RUN_STATUSES.has(normalized)) return "danger";
  // Lease expired: contact lost — muted/neutral "lost contact", never a
  // failure and not the amber "needs you" of a blocked run.
  if (normalized === "host_unknown") return "default";
  if (REVIEW_RUN_STATUSES.has(normalized)) return "warning";
  if (ACTIVE_RUN_STATUSES.has(normalized)) return "warning";
  if (COMPLETED_RUN_STATUSES.has(normalized)) return "success";
  return "default";
}

function formatAgentLabel(agentType?: string | null): string {
  const normalized = agentType?.trim().toLowerCase();
  if (!normalized) return "Agent";
  if (normalized.includes("claude")) return "Claude";
  if (normalized.includes("grok")) return "Grok";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("codex")) return "Codex";

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
