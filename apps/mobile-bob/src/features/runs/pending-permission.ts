import type { ServerEvent } from "@bob/ws";

/**
 * A run is awaiting approval when a permission_request event has no matching
 * permission_resolved. The latest unresolved request drives the banner;
 * approving or denying resolves it via the gateway.
 */
export function derivePendingPermission(
  events: ServerEvent[],
): { requestId: string; toolName?: string } | null {
  const resolved = new Set<string>();
  let latestRunStatus: string | undefined;
  for (const event of events) {
    if (event.eventType === ("permission_resolved" as never)) {
      const requestId = (event.payload as { requestId?: string }).requestId;
      if (requestId) resolved.add(requestId);
    } else if (event.eventType === ("status_change" as never)) {
      const status = (event.payload as { status?: string }).status;
      if (status) latestRunStatus = status;
    }
  }
  // Once the run leaves "blocked" (resumed or ended), any lingering request is
  // stale — clear the banner. status_change events are always replayed even
  // when chatty output is truncated, so this stays correct.
  if (latestRunStatus !== undefined && latestRunStatus !== "blocked") {
    return null;
  }
  // The newest UNRESOLVED request drives the banner. Keep scanning past a
  // resolved newest request to surface an older still-pending one (the adapter
  // supports concurrent pending prompts) instead of stopping early.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (event.eventType === ("permission_request" as never)) {
      const payload = event.payload as { requestId?: string; toolName?: string };
      if (payload.requestId && !resolved.has(payload.requestId)) {
        return { requestId: payload.requestId, toolName: payload.toolName };
      }
    }
  }
  return null;
}
