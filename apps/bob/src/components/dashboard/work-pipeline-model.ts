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
  status: string;
  queueSortOrder?: number | null;
  agentStatus?: WorkPipelineAgentStatus | null;
}

const ACTIVE_STATUSES = new Set(["in_progress", "running"]);
const QUEUED_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const REVIEW_STATUSES = new Set(["blocked", "in_review", "review"]);
const DONE_STATUSES = new Set(["done", "completed", "cancelled", "canceled"]);
const ACTIVE_AGENT_STATUSES = new Set(["running", "starting", "provisioning"]);

function hasActiveAgent(item: WorkPipelineItem): boolean {
  return item.agentStatus
    ? ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
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
