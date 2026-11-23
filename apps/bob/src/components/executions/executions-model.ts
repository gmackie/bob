/**
 * View model for /executions: the sessions Bob runs itself, including work
 * dispatched by external systems such as GenTrellis research. Research
 * management (projects, hill climbing, start/stop) lives in GenTrellis; this
 * view only shows Bob's executions and links back to their origin.
 */

export const RESEARCH_SOURCE_SYSTEM = "gentrellis-research";

export type ExecutionFilterKey = "all" | typeof RESEARCH_SOURCE_SYSTEM;

export interface ExecutionFilter {
  key: ExecutionFilterKey;
  label: string;
  /** session.list `source` input; undefined lists every execution. */
  source?: string;
}

const EXECUTION_FILTERS: ExecutionFilter[] = [
  { key: "all", label: "All executions" },
  { key: RESEARCH_SOURCE_SYSTEM, label: "Autolab", source: RESEARCH_SOURCE_SYSTEM },
];

export function getExecutionFilters(): ExecutionFilter[] {
  return [...EXECUTION_FILTERS];
}

export function normalizeExecutionFilter(
  value: string | null | undefined,
): ExecutionFilter {
  return (
    EXECUTION_FILTERS.find((filter) => filter.key === value) ??
    EXECUTION_FILTERS[0]!
  );
}

export function getExecutionFilterHref(key: ExecutionFilterKey): string {
  return key === "all" ? "/executions" : `/executions?source=${key}`;
}

export interface DispatchSource {
  system: string;
  kind?: string;
  environment?: string;
  suggestionId?: string;
  url?: string;
  /** Attributed from the prompt of a dispatch made before provenance existed. */
  inferred?: boolean;
}

export interface ExecutionSessionInput {
  id: string;
  title: string | null;
  status: string;
  agentType?: string | null;
  gitBranch?: string | null;
  lastActivityAt?: string | Date | null;
  updatedAt?: string | Date | null;
  lastError?: string | null;
  dispatchSource?: DispatchSource | Record<string, unknown> | null;
}

export type ExecutionTone = "default" | "active" | "success" | "danger" | "warning";

export interface ExecutionRow {
  id: string;
  title: string;
  href: string;
  statusLabel: string;
  tone: ExecutionTone;
  canStop: boolean;
  agentLabel: string | null;
  branch: string | null;
  activityLabel: string;
  originLabel: string | null;
  originHref: string | null;
  error: string | null;
}

const ACTIVE_STATUSES = new Set([
  "pending",
  "provisioning",
  "starting",
  "running",
  "blocked",
  "idle",
]);
const SUCCESS_STATUSES = new Set(["completed", "done"]);
const FAILED_STATUSES = new Set(["error", "failed"]);
const STOPPED_STATUSES = new Set(["stopping", "stopped", "cancelled", "interrupted"]);

const SOURCE_LABELS: Record<string, string> = {
  [RESEARCH_SOURCE_SYSTEM]: "Autolab",
};

function toneFor(status: string): ExecutionTone {
  if (status === "host_unknown" || status === "blocked") return "warning";
  if (ACTIVE_STATUSES.has(status)) return "active";
  if (SUCCESS_STATUSES.has(status)) return "success";
  if (FAILED_STATUSES.has(status)) return "danger";
  return "default";
}

function statusLabelFor(status: string): string {
  if (status === "host_unknown") return "Host unknown";
  if (status === "blocked") return "Waiting for input";
  if (STOPPED_STATUSES.has(status) || ACTIVE_STATUSES.has(status) ||
      SUCCESS_STATUSES.has(status) || FAILED_STATUSES.has(status)) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
  return status.replace(/[_-]/g, " ");
}

export function formatAge(value: string | Date | null | undefined, now: Date): string | null {
  if (!value) return null;
  const diff = now.getTime() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return null;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Activity age is reported as an observation only. A quiet running session is
 * not shown as stopped: only the executor's recorded status says that.
 */
function activityLabelFor(session: ExecutionSessionInput, now: Date): string {
  if (session.status === "host_unknown") {
    return "Contact lost — process state unknown";
  }
  const age = formatAge(session.lastActivityAt ?? session.updatedAt, now);
  return age ? `Last activity ${age}` : "No activity recorded";
}

function readSource(value: ExecutionSessionInput["dispatchSource"]): DispatchSource | null {
  if (!value || typeof value !== "object") return null;
  const system = (value as Record<string, unknown>).system;
  return typeof system === "string" ? (value as DispatchSource) : null;
}

export function buildExecutionRow(
  session: ExecutionSessionInput,
  now: Date = new Date(),
): ExecutionRow {
  const source = readSource(session.dispatchSource);
  const sourceName = source ? (SOURCE_LABELS[source.system] ?? source.system) : null;
  const originLabel = source
    ? [sourceName, source.environment].filter(Boolean).join(" · ")
    : null;
  const originHref =
    source?.url && source.url.startsWith("https://") ? source.url : null;

  return {
    id: session.id,
    title: session.title?.trim() || "Untitled session",
    href: `/sessions/${session.id}`,
    statusLabel: statusLabelFor(session.status),
    tone: toneFor(session.status),
    canStop: ACTIVE_STATUSES.has(session.status) || session.status === "host_unknown",
    agentLabel: session.agentType ?? null,
    branch: session.gitBranch ?? null,
    activityLabel: activityLabelFor(session, now),
    originLabel,
    originHref,
    error: FAILED_STATUSES.has(session.status) ? (session.lastError ?? null) : null,
  };
}
