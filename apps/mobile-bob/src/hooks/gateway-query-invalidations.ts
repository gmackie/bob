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
  // `Array.isArray` narrows to `any[]` in TS's lib types (a known limitation
  // of its `value is any[]` signature), so re-assert the element type as
  // `unknown` explicitly rather than letting the `any` leak through.
  const rawRoot: unknown = Array.isArray(first) ? (first as unknown[])[0] : first;
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
