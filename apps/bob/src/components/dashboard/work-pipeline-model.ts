export interface WorkPipelineAgentStatus {
  sessionId: string;
  status: string;
  agentType: string;
}

export interface WorkPipelineItem {
  id: string;
  identifier: string;
  title: string;
  kind: string;
  workspaceId?: string | null;
  status: string;
  queueSortOrder?: number | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  agentStatus?: WorkPipelineAgentStatus | null;
}

export type ProviderKey = "claude" | "codex" | "grok" | "cursor-agent";
export type DashboardTone = "default" | "warning" | "danger" | "success";

// Every agent Bob rotates through (see autoDrain AGENT_ROTATION). The dashboard
// shows one capacity card per provider, in dispatch-rotation order. Claude and
// Grok run on subscriptions (no metered API quota), so their cards report
// live active/queued counts without the usage bars that Codex/Cursor expose.
const PROVIDER_ORDER: ProviderKey[] = ["claude", "codex", "grok", "cursor-agent"];
const PROVIDER_LABELS: Record<ProviderKey, string> = {
  claude: "Claude",
  grok: "Grok",
  codex: "Codex",
  "cursor-agent": "Cursor",
};

export interface ProviderSessionSummary {
  id: string;
  status: string;
  agentType: string;
}

export interface ProviderCapacitySummary {
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

export interface WorkLaneSummary {
  key: "needs-attention" | "ready" | "active" | "review";
  title: string;
  count: number;
  tone: DashboardTone;
}

export type WorkLaneKey = WorkLaneSummary["key"];
export interface WorkLaneRowModel {
  status: string;
  statusLabel: string;
  statusTone: DashboardTone;
}

export interface RecentlyCompletedRowModel {
  status: string;
  statusLabel: string;
  statusTone: DashboardTone;
}

export interface WorkPipelineHeaderModel {
  title: "Operations";
  subtitle: null;
}

export interface WorkLaneTableHeaderModel {
  title: WorkLaneSummary["title"];
  subtitle: null;
}

export type WorkPipelineSectionKey = "summary-boxes" | "recently-completed";
export type RunningNowScope =
  | { mode: "workspace"; workspaceId: string }
  | { mode: "all" };

const WORK_PIPELINE_SECTION_ORDER: WorkPipelineSectionKey[] = [
  "summary-boxes",
  "recently-completed",
];

const ACTIVE_STATUSES = new Set(["in_progress", "running"]);
const QUEUED_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const REVIEW_STATUSES = new Set(["blocked", "in_review", "review"]);
const DONE_STATUSES = new Set(["done", "completed", "cancelled", "canceled", "stopped"]);
const ACTIVE_AGENT_STATUSES = new Set([
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
const STARTING_AGENT_STATUSES = new Set(["starting", "provisioning", "pending"]);
const FAILED_AGENT_STATUSES = new Set(["error", "failed", "interrupted"]);
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
const FAILED_WORK_STATUSES = new Set(["error", "failed", "interrupted"]);
const FAILED_OUTCOME_STATUSES = new Set(["error", "failed", "interrupted"]);
const REVIEW_OUTCOME_STATUSES = new Set(["in_review", "review"]);

function hasActiveAgent(item: WorkPipelineItem): boolean {
  return item.agentStatus
    ? ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
    : false;
}

function hasFailedAgent(item: WorkPipelineItem): boolean {
  return item.agentStatus
    ? FAILED_AGENT_STATUSES.has(item.agentStatus.status)
    : false;
}

export function formatPipelineStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function orderWorkPipelineItems(items: WorkPipelineItem[]) {
  return [...items].sort((left, right) => {
    const leftOrder = left.queueSortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.queueSortOrder ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.identifier.localeCompare(right.identifier);
  });
}

export function groupWorkPipelineItems(items: WorkPipelineItem[]) {
  const ordered = orderWorkPipelineItems(items);

  return {
    active: ordered.filter(
      (item) => hasActiveAgent(item) || ACTIVE_STATUSES.has(item.status),
    ),
    queued: ordered.filter(
      (item) => !hasActiveAgent(item) && QUEUED_STATUSES.has(item.status),
    ),
    review: ordered.filter(
      (item) => !hasActiveAgent(item) && REVIEW_STATUSES.has(item.status),
    ),
    done: ordered.filter(
      (item) => !hasActiveAgent(item) && DONE_STATUSES.has(item.status),
    ),
  };
}

export function buildWorkLaneSummaries(items: WorkPipelineItem[]): WorkLaneSummary[] {
  const needsAttention = filterWorkLaneItems(items, "needs-attention");
  const ready = filterWorkLaneItems(items, "ready");
  const active = filterWorkLaneItems(items, "active");
  const review = filterWorkLaneItems(items, "review");

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

// Lane → work-item statuses, for the count-based summaries. Board-state view:
// "active" means a card marked in_progress/running (execution liveness is the
// separate Running-now rail). Keeping this a pure status map is what lets the
// counts come from an uncapped GROUP BY instead of a truncated list of rows.
const LANE_STATUSES: Record<WorkLaneKey, string[]> = {
  "needs-attention": ["blocked", "error", "failed", "interrupted"],
  ready: ["backlog", "todo", "ready", "draft"],
  active: ["in_progress", "running"],
  review: ["in_review", "review"],
};

const LANE_META: Array<{ key: WorkLaneKey; title: string; activeTone: DashboardTone }> = [
  { key: "needs-attention", title: "Needs Attention", activeTone: "danger" },
  { key: "ready", title: "Ready", activeTone: "success" },
  { key: "active", title: "Active", activeTone: "success" },
  { key: "review", title: "Review", activeTone: "warning" },
];

/**
 * The work-item statuses a lane fetches, so its table can request only its own
 * rows (status-scoped) instead of slicing the recency-capped list. Includes a
 * generous superset for needs-attention so failed/blocked rows are fetched;
 * `filterWorkLaneItems` still applies the precise per-lane predicate.
 */
export function getLaneQueryStatuses(lane: WorkLaneKey): string[] {
  return [...LANE_STATUSES[lane]];
}

/**
 * Build the four lane summary cards from uncapped per-status counts
 * (`workItem.statusCounts`). This replaces counting a recency-capped page of
 * rows — the bug where a workspace full of `in_review` items pushed the
 * backlog past the 100-row cap and every lane read 0.
 */
export function buildWorkLaneSummariesFromCounts(
  counts: Record<string, number>,
): WorkLaneSummary[] {
  return LANE_META.map(({ key, title, activeTone }) => {
    const count = LANE_STATUSES[key].reduce(
      (total, status) => total + (counts[status] ?? 0),
      0,
    );
    return {
      key,
      title,
      count,
      tone: count > 0 ? activeTone : "default",
    };
  });
}

export function getWorkPipelineHeaderModel(): WorkPipelineHeaderModel {
  return {
    title: "Operations",
    subtitle: null,
  };
}

export function getWorkLaneTableHeaderModel(lane: WorkLaneKey): WorkLaneTableHeaderModel {
  const summary = buildWorkLaneSummaries([]).find((entry) => entry.key === lane);

  return {
    title: summary?.title ?? "Work",
    subtitle: null,
  };
}

export function getWorkPipelineSectionOrder(): WorkPipelineSectionKey[] {
  return [...WORK_PIPELINE_SECTION_ORDER];
}

export function getRecentlyCompletedWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ view: "outcome" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/work-items/${workItemId}?${params.toString()}`;
}

export function getWorkLaneWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ view: "queue" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/work-items/${workItemId}?${params.toString()}`;
}

export function getWorkLaneEntryHref(
  item: WorkPipelineItem,
  lane: WorkLaneKey,
  workspaceId?: string | null,
): string {
  const targetWorkspaceId = workspaceId ?? item.workspaceId;
  if (lane === "active" || lane === "review") {
    return getRecentlyCompletedWorkItemHref(item.id, targetWorkspaceId);
  }

  if (
    lane === "needs-attention" &&
    (FAILED_WORK_STATUSES.has(item.status) ||
      (item.agentStatus && FAILED_AGENT_STATUSES.has(item.agentStatus.status)))
  ) {
    return getRecentlyCompletedWorkItemHref(item.id, targetWorkspaceId);
  }

  return getWorkLaneWorkItemHref(item.id, targetWorkspaceId);
}

export function getProviderCapacityHref(
  provider: ProviderKey,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ provider });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/runs?${params.toString()}`;
}

export function getRunningNowScope(workspaceId?: string | null): RunningNowScope {
  return workspaceId ? { mode: "workspace", workspaceId } : { mode: "all" };
}

export function filterWorkLaneItems(
  items: WorkPipelineItem[],
  lane: WorkLaneKey,
): WorkPipelineItem[] {
  const ordered = orderWorkPipelineItems(items).filter((item) => item.kind === "task");

  switch (lane) {
    case "needs-attention":
      return ordered.filter((item) => {
        if (item.status === "blocked") return true;
        if (FAILED_WORK_STATUSES.has(item.status)) return true;
        return item.agentStatus ? FAILED_AGENT_STATUSES.has(item.agentStatus.status) : false;
      });
    case "ready":
      return ordered.filter(
        (item) =>
          QUEUED_STATUSES.has(item.status) &&
          !hasActiveAgent(item) &&
          !hasFailedAgent(item),
      );
    case "active":
      return ordered.filter((item) => hasActiveAgent(item) || ACTIVE_STATUSES.has(item.status));
    case "review":
      return ordered.filter((item) => item.status === "in_review" || item.status === "review");
  }
}

export function getWorkLaneRowModel(
  item: WorkPipelineItem,
  lane: WorkLaneKey,
): WorkLaneRowModel {
  const status = getWorkLaneRowStatus(item, lane);

  return {
    status,
    statusLabel: formatPipelineStatus(status),
    statusTone: getWorkLaneStatusTone(status),
  };
}

function getWorkLaneRowStatus(item: WorkPipelineItem, lane: WorkLaneKey): string {
  if (
    lane === "needs-attention" &&
    item.agentStatus &&
    FAILED_AGENT_STATUSES.has(item.agentStatus.status)
  ) {
    return item.agentStatus.status;
  }

  if (
    lane === "active" &&
    item.agentStatus &&
    ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
  ) {
    return item.agentStatus.status;
  }

  return item.status;
}

function getWorkLaneStatusTone(status: string): DashboardTone {
  if (
    status === "blocked" ||
    status === "failed" ||
    status === "error" ||
    status === "interrupted"
  ) {
    return "danger";
  }
  if (status === "in_review" || status === "review" || status === "pending") return "warning";
  if (
    status === "done" ||
    status === "completed" ||
    status === "in_progress" ||
    status === "running" ||
    status === "starting" ||
    status === "provisioning"
  ) {
    return "success";
  }
  return "default";
}

export function buildRecentlyCompletedItems(
  items: WorkPipelineItem[],
  limit = 5,
): WorkPipelineItem[] {
  return items
    .filter((item) => item.kind === "task" && isRecentlyCompletedItem(item))
    .sort((left, right) => completionTime(right) - completionTime(left))
    .slice(0, limit);
}

export function getRecentlyCompletedRowModel(
  item: WorkPipelineItem,
): RecentlyCompletedRowModel {
  const status = getRecentlyCompletedItemStatus(item);

  return {
    status,
    statusLabel: formatPipelineStatus(status),
    statusTone: getRecentlyCompletedStatusTone(status),
  };
}

export function buildRecentOutcomeItems(
  items: WorkPipelineItem[],
  limit = 5,
): WorkPipelineItem[] {
  return items
    .filter((item) => {
      if (item.kind !== "task") return false;
      if (DONE_STATUSES.has(item.status)) return true;
      if (FAILED_OUTCOME_STATUSES.has(item.status)) return true;
      if (REVIEW_OUTCOME_STATUSES.has(item.status)) return true;
      return item.agentStatus
        ? TERMINAL_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status)
        : false;
    })
    .sort((left, right) => completionTime(right) - completionTime(left))
    .slice(0, limit);
}

function completionTime(item: WorkPipelineItem): number {
  const value = item.completedAt ?? item.updatedAt;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function isRecentlyCompletedItem(item: WorkPipelineItem): boolean {
  if (DONE_STATUSES.has(item.status)) return true;
  return item.agentStatus
    ? COMPLETED_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status)
    : false;
}

function getRecentlyCompletedItemStatus(item: WorkPipelineItem): string {
  const agentStatus = item.agentStatus?.status;
  if (
    !DONE_STATUSES.has(item.status) &&
    agentStatus &&
    COMPLETED_AGENT_OUTCOME_STATUSES.has(agentStatus)
  ) {
    return agentStatus;
  }

  return item.status;
}

function getRecentlyCompletedStatusTone(status: string): DashboardTone {
  if (status === "completed" || status === "done") return "success";
  return "default";
}

function getProvider(agentType: string): ProviderKey {
  const normalized = agentType.toLowerCase();
  if (normalized.includes("cursor")) return "cursor-agent";
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("grok")) return "grok";
  // Default to codex — it's the historical default and covers "codex"/unknown.
  return "codex";
}

function buildProviderCapacitySummary(
  provider: ProviderKey,
  sessions: ProviderSessionSummary[],
  queuedCount: number,
  snapshot?: ProviderCapacitySnapshot | null,
): ProviderCapacitySummary {
  const matching = sessions.filter((session) => getProvider(session.agentType) === provider);
  const activeCount = matching.filter((session) => ACTIVE_AGENT_STATUSES.has(session.status)).length;
  const startingCount = matching.filter((session) => STARTING_AGENT_STATUSES.has(session.status)).length;
  const hasFailure = matching.some((session) => FAILED_AGENT_STATUSES.has(session.status));
  const usageLimits = snapshot?.usageLimits ?? getDefaultProviderUsageLimits(provider);
  const isSubscription = provider === "claude" || provider === "grok";

  return {
    provider,
    label: PROVIDER_LABELS[provider],
    activeCount,
    queuedOrStartingCount: startingCount + (provider === "codex" ? queuedCount : 0),
    // Subscription providers have no capacity socket to connect; their card is
    // "live" whenever it has work, rather than reporting a metered quota link.
    limitLabel: snapshot
      ? "Capacity connected"
      : isSubscription
        ? "Subscription"
        : "Capacity not connected",
    statusLabel: hasFailure ? "Recent failure" : "Normal",
    tone: hasFailure ? "danger" : activeCount > 0 ? "success" : "default",
    usageLimits,
  };
}

export function buildProviderCapacitySummaries(input: {
  sessions: ProviderSessionSummary[];
  workItems: WorkPipelineItem[];
  capacitySnapshots?: ProviderCapacitySnapshot[];
}): ProviderCapacitySummary[] {
  const queuedCount = input.workItems.filter(
    (item) => item.kind === "task" && QUEUED_STATUSES.has(item.status),
  ).length;
  const snapshots = new Map(
    (input.capacitySnapshots ?? []).map((snapshot) => [snapshot.provider, snapshot]),
  );

  return PROVIDER_ORDER.map((provider) =>
    buildProviderCapacitySummary(
      provider,
      input.sessions,
      queuedCount,
      snapshots.get(provider),
    ),
  );
}

export function getProviderCapacityStatusLine(card: ProviderCapacitySummary): string {
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
  const observed = (capacity as { observed?: unknown }).observed;
  if (observed && typeof observed === "object") {
    const usage = observed as { inputTokens?: unknown; outputTokens?: unknown };
    const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
    const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
    return [buildProviderUsageLimit({
      label: "Bob observed usage",
      valueLabel: `${inputTokens + outputTokens} tokens`,
      resetLabel: null,
    })];
  }
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
  switch (provider) {
    case "codex":
      return [
        buildProviderUsageLimit({ label: "5 hour usage limit", remainingPercent: null, resetLabel: null }),
        buildProviderUsageLimit({ label: "Weekly usage limit", remainingPercent: null, resetLabel: null }),
      ];
    case "cursor-agent":
      return [
        buildProviderUsageLimit({ label: "Included usage", remainingPercent: null, resetLabel: null }),
        buildProviderUsageLimit({ label: "On-demand spend", remainingPercent: null, resetLabel: null }),
      ];
    // Claude / Grok run on a subscription — no metered quota to chart. Show a
    // single informational row (valueLabel "Subscription") instead of an empty
    // "Unavailable" bar, so the card reads intentional rather than broken.
    default:
      return [
        buildProviderUsageLimit({
          label: "Plan",
          remainingPercent: null,
          valueLabel: "Subscription",
          resetLabel: null,
        }),
      ];
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
