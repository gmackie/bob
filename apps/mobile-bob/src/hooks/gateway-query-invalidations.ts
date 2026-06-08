import type { QueryClient } from "@tanstack/react-query";

const GATEWAY_EVENT_INVALIDATION_ROOTS = new Set([
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

const GATEWAY_REALTIME_INVALIDATION_MESSAGES = new Set([
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

export function getGatewayEventQueryRoot(queryKey: readonly unknown[]): string {
  const first = queryKey[0];
  const rawRoot = Array.isArray(first) ? first[0] : first;
  if (typeof rawRoot !== "string") return "";

  return rawRoot.split(".")[0] ?? "";
}

export function shouldInvalidateGatewayEventQuery(queryKey: readonly unknown[]): boolean {
  return GATEWAY_EVENT_INVALIDATION_ROOTS.has(getGatewayEventQueryRoot(queryKey));
}

export function shouldInvalidateGatewayRealtimeMessage(type: string): boolean {
  return GATEWAY_REALTIME_INVALIDATION_MESSAGES.has(type);
}

export function invalidateGatewayEventQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  messageType?: string,
): void {
  if (messageType && !shouldInvalidateGatewayRealtimeMessage(messageType)) return;

  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key) || key.length === 0) return false;
      return shouldInvalidateGatewayEventQuery(key);
    },
  });
}
