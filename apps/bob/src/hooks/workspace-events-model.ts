const WORKSPACE_EVENT_INVALIDATION_ROOTS = new Set([
  "activity",
  "agentRun",
  "artifact",
  "capacity",
  "comment",
  "dispatch",
  "featureBranch",
  "filesystem",
  "git",
  "gitProviders",
  "instance",
  "integration",
  "link",
  "notification",
  "plan",
  "planning",
  "planSession",
  "provider",
  "providerCapacity",
  "project",
  "pullRequest",
  "repository",
  "requirement",
  "session",
  "taskRun",
  "workItem",
  "workItems",
  "workspace",
]);

const WORKSPACE_REALTIME_INVALIDATION_MESSAGES = new Set([
  "event",
  "planning_session_produced_drafts",
  "planning_session_produced_tasks",
  "git_status_changed",
  "project_sync_changed",
  "provider_capacity_changed",
  "provider_limit_changed",
  "queue_order_changed",
  "session_created",
  "session_event_appended",
  "session_status_changed",
  "session_stopped",
  "task_priority_changed",
  "task_status_changed",
  "work_item_dispatched",
  "workspace_snapshot",
]);

export function getWorkspaceEventQueryRoot(queryKey: readonly unknown[]): string {
  const first = queryKey[0];
  const rawRoot = Array.isArray(first) ? first[0] : first;
  if (typeof rawRoot !== "string") return "";

  return rawRoot.split(".")[0] ?? "";
}

export function shouldInvalidateQueryForWorkspaceEvent(queryKey: readonly unknown[]): boolean {
  return WORKSPACE_EVENT_INVALIDATION_ROOTS.has(getWorkspaceEventQueryRoot(queryKey));
}

export function shouldInvalidateForWorkspaceRealtimeMessage(type: string): boolean {
  return WORKSPACE_REALTIME_INVALIDATION_MESSAGES.has(type);
}
