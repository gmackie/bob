import { emptyView } from "@bob/sdlc-view";
import {
  edgeStatus,
  fleet,
  itemForThread,
  threadItem,
} from "../../src/server/mcp/views/sdlc-model";
import type { AttemptEdge } from "./attempt-edge";
import type { EdgeStore } from "./store";

/** Build the MCP result inside the workspace DO. Only the requested projection leaves it. */
export async function mcpSdlcResponse(
  url: URL,
  store: EdgeStore,
  attempts: Pick<AttemptEdge, "detail">,
) {
  const threadId = url.searchParams.get("threadId");
  const raw = url.searchParams.get("raw") === "true";
  if ((threadId !== null && (!threadId || threadId.length > 200)) || (raw && !threadId))
    return Response.json({ error: "Invalid thread id" }, { status: 400 });
  const view = emptyView();
  view.coordinatorSeenAt = store.coordinatorSeenAt();
  view.items = Object.fromEntries(
    store.items(threadId ?? undefined).map((item) => [item.itemId, item]),
  );
  const status = edgeStatus({ view, connection: "live", error: null }, threadId ? 5 : 15);
  if (!threadId) {
    view.plans = Object.fromEntries(store.plans().map((plan) => [plan.planId, plan]));
    return Response.json({ scope: "fleet", ...fleet(view), ...status });
  }
  const item = itemForThread(view, threadId);
  const plan = item ? store.plan(item.planId) : undefined;
  if (raw)
    return Response.json({ threadId, item, plan: plan ?? null, connection: status.connection });
  if (plan) view.plans[plan.planId] = plan;
  return Response.json({
    scope: "thread",
    threadId,
    item: item ? threadItem(view, item, await attempts.detail(item)) : null,
    ...status,
  });
}
