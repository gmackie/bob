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
  queueSortOrder?: number | null;
  agentStatus?: TabletQueueAgentStatus | null;
}

export type QueueMoveDirection = "up" | "down";

const ACTIVE_WORK_ITEM_STATUSES = new Set(["in_progress", "running"]);
const QUEUED_WORK_ITEM_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const REVIEW_WORK_ITEM_STATUSES = new Set(["in_review", "review", "blocked"]);
const DONE_WORK_ITEM_STATUSES = new Set(["done", "completed", "cancelled", "canceled"]);
const ACTIVE_AGENT_STATUSES = new Set(["running", "starting", "provisioning"]);

export interface TabletWorkItemDetail extends TabletQueueItem {
  description: string | null;
  currentArtifacts?: {
    id: string;
    title: string | null;
    artifactRole: string;
    artifactType: string;
    url: string | null;
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
  items: TabletQueueItem[],
): TabletQueueItem[] {
  return [...items].sort((left, right) => {
    const leftOrder = left.queueSortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.queueSortOrder ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.identifier.localeCompare(right.identifier);
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
): string[] {
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
