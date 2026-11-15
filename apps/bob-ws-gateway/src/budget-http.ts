/**
 * BOB-76: POST /internal/budget-usage, where the proxy host's budget collector
 * delivers token-ledger totals (apps/ooda-runner/src/budget/collector.ts).
 *
 * The body is the same budget_usage message a runner sends on its socket, plus
 * the workspace and reporting host. Only a Bob API key owned by that
 * workspace's owner may write it; the legacy shared secret is refused because
 * this endpoint never had legacy callers. Rows are validated by
 * ingestBudgetUsage, exactly as for the socket path.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { InternalPrincipal } from "./auth.js";
import { bearerFrom, readJsonBody } from "./nudge.js";

export interface BudgetUsageHttpConfig {
  authorize: (bearer: string) => Promise<InternalPrincipal | null>;
  resolveWorkspaceOwner: (workspaceId: string) => Promise<string | null>;
  onAudit?: (principal: InternalPrincipal, action: string, payload: Record<string, unknown>) => void;
  ingest: (scope: { workspaceId: string; hostId: string }, message: { buckets?: unknown; sessions?: unknown; links?: unknown }) => Promise<void>;
}

const HOST_ID = /^[A-Za-z0-9._-]{1,100}$/;
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,64}$/;

function reply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createBudgetUsageHandler(cfg: BudgetUsageHttpConfig) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const bearer = bearerFrom(req.headers.authorization);
    const principal = bearer ? await cfg.authorize(bearer) : null;
    if (principal?.kind !== "apiKey") {
      reply(res, 401, { error: "Unauthorized" });
      return;
    }

    const body = await readJsonBody(req);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      reply(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const message = body as { workspaceId?: unknown; hostId?: unknown; buckets?: unknown; sessions?: unknown; links?: unknown };
    const workspaceId = typeof message.workspaceId === "string" && WORKSPACE_ID.test(message.workspaceId) ? message.workspaceId : undefined;
    const hostId = typeof message.hostId === "string" && HOST_ID.test(message.hostId) ? message.hostId : undefined;
    if (!workspaceId || !hostId) {
      reply(res, 400, { error: "workspaceId and hostId are required" });
      return;
    }

    const owner = await cfg.resolveWorkspaceOwner(workspaceId);
    if (!owner || owner !== principal.userId) {
      cfg.onAudit?.(principal, "internal.denied", { endpoint: "budget-usage", workspaceId, hostId });
      reply(res, 403, { error: "Forbidden: key does not own this workspace" });
      return;
    }

    try {
      await cfg.ingest({ workspaceId, hostId }, message);
    } catch (error) {
      // The collector keeps the totals and retries; nothing here is lost.
      console.error("[budget] collector usage failed:", error instanceof Error ? error.message : error);
      reply(res, 500, { error: "budget usage not stored" });
      return;
    }
    reply(res, 200, { ok: true });
  };
}
