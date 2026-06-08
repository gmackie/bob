export interface TabletQueueAgentStatus {
  sessionId: string;
  status: string;
  agentType: string;
}

export interface TabletQueueItem {
  id: string;
  identifier: string;
  title: string;
  kind: string;
  status: string;
  priority?: string | null;
  queueSortOrder?: number | null;
  updatedAt?: string | Date | null;
  completedAt?: string | Date | null;
  agentStatus?: TabletQueueAgentStatus | null;
  project?: TabletProjectSummary | null;
  dependencies?: TabletRelatedWorkItem[] | null;
  dependents?: TabletRelatedWorkItem[] | null;
}

export interface TabletProjectSummary {
  id: string;
  key?: string | null;
  name?: string | null;
}

export interface TabletRelatedWorkItem {
  id: string;
  identifier: string;
  title: string;
  status: string;
}

export type QueueMoveDirection = "up" | "down";

export type PriorityQueueControlKey = "save" | "sort-priority";
export type QueueItemDispatchAction = { kind: "dispatch" } | { kind: "none" };

export interface PriorityQueueControl {
  key: PriorityQueueControlKey;
  label: string;
  disabled: boolean;
}

export interface MobilePriorityQueueHeaderModel {
  title: "Priority Queue";
  subtitle: null;
}

const ACTIVE_WORK_ITEM_STATUSES = new Set(["in_progress", "running"]);
const QUEUED_WORK_ITEM_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const DISPATCHABLE_WORK_ITEM_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const REVIEW_WORK_ITEM_STATUSES = new Set(["in_review", "review", "blocked"]);
const DONE_WORK_ITEM_STATUSES = new Set(["done", "completed", "cancelled", "canceled", "stopped"]);
const FAILED_WORK_ITEM_STATUSES = new Set(["error", "failed", "interrupted"]);
const ACTIVE_AGENT_STATUSES = new Set([
  "running",
  "starting",
  "provisioning",
  "queued",
  "pending",
  "awaiting-input",
  "awaiting_input",
]);
const FAILED_AGENT_STATUSES = new Set(["error", "failed", "interrupted"]);
const TERMINAL_AGENT_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "stopped",
]);

export interface TabletWorkItemDetail extends TabletQueueItem {
  description: string | null;
  currentArtifacts?: {
    id: string;
    title: string | null;
    artifactRole: string;
    artifactType: string;
    summary?: string | null;
    url: string | null;
    metadata?: Record<string, unknown> | null;
  }[];
  sessions?: { id: string; status: string; planningSessionType: string | null }[];
}

export function formatStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasActiveAgent(item: TabletQueueItem): boolean {
  return item.agentStatus
    ? ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
    : false;
}

export function buildExecutionQueue(
  items: TabletQueueItem[] | null | undefined,
): TabletQueueItem[] {
  return [...(items ?? [])].sort((left, right) => {
    const leftOrder = left.queueSortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.queueSortOrder ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.identifier.localeCompare(right.identifier);
  });
}

export function getMobilePriorityQueueHeaderModel(): MobilePriorityQueueHeaderModel {
  return {
    title: "Priority Queue",
    subtitle: null,
  };
}

export function buildPriorityQueueItems(
  items: TabletQueueItem[] | null | undefined,
): TabletQueueItem[] {
  const upcomingItems = (items ?? []).filter((item) => {
    if (item.kind !== "task") return false;
    if (DONE_WORK_ITEM_STATUSES.has(item.status)) return false;
    if (FAILED_WORK_ITEM_STATUSES.has(item.status)) return false;
    if (REVIEW_WORK_ITEM_STATUSES.has(item.status)) return false;
    if (ACTIVE_WORK_ITEM_STATUSES.has(item.status)) return false;
    if (item.agentStatus && FAILED_AGENT_STATUSES.has(item.agentStatus.status)) return false;
    if (item.agentStatus && TERMINAL_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status)) return false;
    return !hasActiveAgent(item);
  });

  return sortQueueItemsByPriority(upcomingItems);
}

export function buildPriorityQueueSaveOrder(items: TabletQueueItem[]): string[] {
  return items.map((item) => item.id);
}

export function buildPriorityQueueControls(input: {
  itemCount: number;
  isSaving: boolean;
}): PriorityQueueControl[] {
  const disabled = input.itemCount === 0 || input.isSaving;

  return [
    {
      key: "save",
      label: input.isSaving ? "Saving..." : "Save queue",
      disabled,
    },
    {
      key: "sort-priority",
      label: "Sort priority",
      disabled,
    },
  ];
}

export function getQueueItemDispatchAction(
  item: TabletQueueItem,
): QueueItemDispatchAction {
  if (item.kind !== "task") {
    return { kind: "none" };
  }

  if (!DISPATCHABLE_WORK_ITEM_STATUSES.has(item.status)) {
    return { kind: "none" };
  }

  return { kind: "dispatch" };
}

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  normal: 3,
  low: 4,
  no_priority: 5,
  none: 5,
};

export function sortQueueItemsByPriority(
  items: TabletQueueItem[],
): TabletQueueItem[] {
  return [...items].sort((left, right) => {
    const leftPriority = priorityWeight(left.priority);
    const rightPriority = priorityWeight(right.priority);

    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    return buildExecutionQueue([left, right])[0]?.id === left.id ? -1 : 1;
  });
}

export function buildQueueLanes(items: TabletQueueItem[]) {
  const ordered = buildExecutionQueue(items);

  return {
    active: ordered.filter(
      (item) => hasActiveAgent(item) || ACTIVE_WORK_ITEM_STATUSES.has(item.status),
    ),
    queued: ordered.filter(
      (item) => !hasActiveAgent(item) && QUEUED_WORK_ITEM_STATUSES.has(item.status),
    ),
    review: ordered.filter(
      (item) => !hasActiveAgent(item) && REVIEW_WORK_ITEM_STATUSES.has(item.status),
    ),
    done: ordered.filter(
      (item) => !hasActiveAgent(item) && DONE_WORK_ITEM_STATUSES.has(item.status),
    ),
  };
}

export function unwrapWorkItemDetail(value: unknown): TabletWorkItemDetail | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { workItem?: unknown; currentArtifacts?: unknown };
  const row = candidate.workItem ?? value;

  const item = row as Partial<TabletWorkItemDetail>;
  if (typeof item.id !== "string" || typeof item.title !== "string") {
    return null;
  }

  const identifier =
    typeof item.identifier === "string" ? item.identifier : item.id.slice(0, 8);
  const kind = typeof item.kind === "string" ? item.kind : "task";
  const status = typeof item.status === "string" ? item.status : "unknown";
  const currentArtifacts = Array.isArray(candidate.currentArtifacts)
    ? (candidate.currentArtifacts as TabletWorkItemDetail["currentArtifacts"])
    : item.currentArtifacts;

  return {
    ...item,
    id: item.id,
    identifier,
    title: item.title,
    description: typeof item.description === "string" ? item.description : null,
    kind,
    status,
    currentArtifacts,
    sessions: item.sessions,
  };
}

export function moveQueueItem(
  itemIds: string[],
  itemId: string,
  direction: QueueMoveDirection,
  orderedItems?: TabletQueueItem[],
): string[] {
  if (orderedItems && !canMoveQueueItem(orderedItems, itemId, direction)) {
    return itemIds;
  }

  const currentIndex = itemIds.indexOf(itemId);
  if (currentIndex === -1) {
    return itemIds;
  }

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= itemIds.length) {
    return itemIds;
  }

  const next = [...itemIds];
  const current = next[currentIndex];
  const target = next[nextIndex];
  if (current === undefined || target === undefined) {
    return itemIds;
  }

  next[currentIndex] = target;
  next[nextIndex] = current;
  return next;
}

export function canMoveQueueItem(
  orderedItems: TabletQueueItem[],
  itemId: string,
  direction: QueueMoveDirection,
): boolean {
  const currentIndex = orderedItems.findIndex((item) => item.id === itemId);
  if (currentIndex === -1) return false;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= orderedItems.length) return false;

  const current = orderedItems[currentIndex];
  const target = orderedItems[nextIndex];
  if (!current || !target) return false;

  return priorityWeight(current.priority) === priorityWeight(target.priority);
}

function priorityWeight(priority?: string | null): number {
  const fallbackPriority = PRIORITY_WEIGHT.none ?? 5;
  return PRIORITY_WEIGHT[priority ?? "none"] ?? fallbackPriority;
}
