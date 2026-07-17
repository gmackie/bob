export interface TaskShellTab {
  href: "/runs" | "/tasks/queue";
  label: "Recent Outcomes" | "Priority Queue";
}

export interface TaskDashboardHeaderModel {
  title: "Tasks";
  subtitle: null;
}

export interface PriorityQueueHeaderModel {
  title: "Priority Queue";
  subtitle: null;
}

export interface TaskDashboardWorkspace {
  id: string;
  name?: string | null;
  slug?: string | null;
}

export function selectTaskDashboardWorkspace(
  memberships: Array<{ workspace?: TaskDashboardWorkspace | null }>,
  workspaceId: string | null,
): TaskDashboardWorkspace | null {
  const workspaces = memberships.flatMap((membership) =>
    membership.workspace ? [membership.workspace] : [],
  );
  return (
    (workspaceId
      ? workspaces.find((workspace) => workspace.id === workspaceId)
      : workspaces[0]) ?? null
  );
}

export type TaskShellRoute = "/tasks" | "/runs" | "/tasks/queue";

export interface PriorityQueueItem {
  id: string;
  identifier: string;
  title: string;
  kind?: string | null;
  workspaceId?: string | null;
  status: string;
  priority?: string | null;
  queueSortOrder?: number | null;
  updatedAt?: string | Date | null;
  agentStatus?: {
    sessionId: string;
    status: string;
    agentType?: string | null;
  } | null;
}

export type PriorityQueueMoveDirection = "up" | "down";

export type PriorityQueueRowAction =
  | { kind: "dispatch" }
  | { kind: "live-session"; sessionId: string }
  | { kind: "none" };

const TASK_SHELL_TABS: TaskShellTab[] = [
  { href: "/runs", label: "Recent Outcomes" },
  { href: "/tasks/queue", label: "Priority Queue" },
];

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  no_priority: 4,
};

const OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "error",
  "failed",
  "interrupted",
  "stopped",
]);

const ACTIVE_WORK_STATUSES = new Set(["in_progress", "running"]);
const REVIEW_WORK_STATUSES = new Set(["blocked", "in_review", "review"]);
const DISPATCHABLE_STATUSES = new Set(["ready", "todo", "backlog", "draft"]);
const ACTIVE_AGENT_STATUSES = new Set([
  "running",
  "starting",
  "provisioning",
  "queued",
  "pending",
  "awaiting-input",
  "awaiting_input",
  // Paused awaiting a human decision — still active (the "needs you" state).
  "blocked",
  // Lease expired: contact lost, process fate unknown — still active.
  "host_unknown",
]);
const FAILED_AGENT_STATUSES = new Set(["error", "failed", "interrupted"]);
const TERMINAL_AGENT_OUTCOME_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "done",
  "stopped",
]);

export function getTaskShellTabs(): TaskShellTab[] {
  return [...TASK_SHELL_TABS];
}

export function getTaskDashboardHeaderModel(): TaskDashboardHeaderModel {
  return {
    title: "Tasks",
    subtitle: null,
  };
}

export function getPriorityQueueHeaderModel(): PriorityQueueHeaderModel {
  return {
    title: "Priority Queue",
    subtitle: null,
  };
}

export function matchTaskShellRoute(pathname: string): TaskShellRoute | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/tasks" || path === "/tasks/") return "/tasks";
  if (path.startsWith("/tasks/queue")) return "/tasks/queue";
  if (path.startsWith("/runs")) return "/runs";
  return null;
}

export function buildPriorityQueueRows<T extends PriorityQueueItem>(items: T[]): T[] {
  return items
    .filter((item) => {
      if (item.kind && item.kind !== "task") return false;
      if (OUTCOME_STATUSES.has(item.status)) return false;
      if (ACTIVE_WORK_STATUSES.has(item.status)) return false;
      if (REVIEW_WORK_STATUSES.has(item.status)) return false;
      if (item.agentStatus && ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)) {
        return false;
      }
      if (item.agentStatus && FAILED_AGENT_STATUSES.has(item.agentStatus.status)) {
        return false;
      }
      if (item.agentStatus && TERMINAL_AGENT_OUTCOME_STATUSES.has(item.agentStatus.status)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDelta !== 0) return priorityDelta;

      const leftOrder = left.queueSortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.queueSortOrder ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      return left.identifier.localeCompare(right.identifier);
    });
}

export function buildPriorityQueueSaveOrder<T extends PriorityQueueItem>(rows: T[]): string[] {
  return rows.map((row) => row.id);
}

export function movePriorityQueueRow<T extends PriorityQueueItem>(
  rows: T[],
  itemId: string,
  direction: PriorityQueueMoveDirection,
): T[] {
  if (!canMovePriorityQueueRow(rows, itemId, direction)) return rows;

  const currentIndex = rows.findIndex((row) => row.id === itemId);
  if (currentIndex === -1) return rows;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= rows.length) return rows;

  const nextRows = [...rows];
  const current = nextRows[currentIndex];
  const target = nextRows[nextIndex];
  if (!current || !target) return rows;

  nextRows[currentIndex] = target;
  nextRows[nextIndex] = current;
  return nextRows;
}

export function canMovePriorityQueueRow(
  rows: PriorityQueueItem[],
  itemId: string,
  direction: PriorityQueueMoveDirection,
): boolean {
  const currentIndex = rows.findIndex((row) => row.id === itemId);
  if (currentIndex === -1) return false;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= rows.length) return false;

  const current = rows[currentIndex];
  const target = rows[nextIndex];
  if (!current || !target) return false;

  return priorityRank(current.priority) === priorityRank(target.priority);
}

export function getPriorityQueueRowAction(item: PriorityQueueItem): PriorityQueueRowAction {
  if (item.kind && item.kind !== "task") {
    return { kind: "none" };
  }

  if (
    item.agentStatus?.sessionId &&
    ACTIVE_AGENT_STATUSES.has(item.agentStatus.status)
  ) {
    return { kind: "live-session", sessionId: item.agentStatus.sessionId };
  }

  if (DISPATCHABLE_STATUSES.has(item.status)) {
    return { kind: "dispatch" };
  }

  return { kind: "none" };
}

export function formatTaskPriority(priority?: string | null): string {
  if (!priority || priority === "no_priority") return "No Priority";
  return priority.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getTaskLaneHref(lane: string, workspaceId?: string | null): string {
  const params = new URLSearchParams({ lane });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/tasks/queue?${params.toString()}`;
}

export function getPriorityQueueHref(workspaceId?: string | null): string {
  if (!workspaceId) return "/tasks/queue";
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/tasks/queue?${params.toString()}`;
}

export function getPriorityQueueWorkItemHref(
  workItemId: string,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams({ view: "queue" });
  if (workspaceId) params.set("workspace", workspaceId);
  return `/work-items/${workItemId}?${params.toString()}`;
}

export function getPriorityQueueSessionHref(
  sessionId: string,
  workspaceId?: string | null,
): string {
  if (!workspaceId) return `/sessions/${sessionId}`;
  const params = new URLSearchParams({ workspace: workspaceId });
  return `/sessions/${sessionId}?${params.toString()}`;
}

function priorityRank(priority?: string | null): number {
  return PRIORITY_RANK[priority ?? "no_priority"] ?? 4;
}
