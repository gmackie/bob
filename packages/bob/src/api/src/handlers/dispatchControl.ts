/**
 * Start and stop the host's standalone task runner from the UI.
 *
 * The circuit breaker keeps a *running* runner from claiming work against dead
 * agents. A runner stopped at the systemd level is a different hole:
 * bob-task-runner polls Linear directly and holds no connection to Bob, so
 * nothing in the UI could reach it and SSH was the only way back — the same
 * wall the credential work was built to remove.
 *
 * Like agentAuth, this API touches nothing itself. It authorises the caller and
 * relays to the ws-gateway, which forwards to the workspace's daemon. The
 * systemd unit is a constant in the daemon; no unit name travels from here.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { workspaces } from "@bob/db/schema";

export const DISPATCH_ACTIONS = ["start", "stop"] as const;
export type DispatchActionId = (typeof DISPATCH_ACTIONS)[number];

interface Ctx {
  db: {
    query: {
      workspaces: {
        findFirst: (args: unknown) => Promise<{ id: string; ownerUserId: string } | undefined>;
      };
    };
  };
  userId: string;
}

/**
 * Starting the runner makes it claim work and spend the owner's agent credits,
 * so this is owner-only rather than any workspace member.
 */
async function assertWorkspaceOwner(ctx: Ctx, workspaceId: string): Promise<void> {
  const workspace = await ctx.db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true, ownerUserId: true },
  });
  if (!workspace) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
  }
  if (workspace.ownerUserId !== ctx.userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the workspace owner can start or stop dispatch",
    });
  }
}

export async function dispatchControlSet(
  ctx: Ctx,
  input: { workspaceId: string; action: DispatchActionId; requestId: string },
) {
  await assertWorkspaceOwner(ctx, input.workspaceId);

  const gatewayUrl = process.env.GATEWAY_URL;
  const secret = process.env.NUDGE_SHARED_SECRET;
  if (!gatewayUrl || !secret) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Gateway is not configured; cannot reach the host daemon",
    });
  }

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/internal/dispatch-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        action: input.action,
        requestId: input.requestId,
      }),
    });
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gateway unreachable" });
  }

  if (response.status === 503) {
    // The node is offline, not the request wrong — say so, so the operator
    // waits for the daemon instead of retrying against nothing.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The host daemon is not connected. Dispatch control needs the node online.",
    });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: response.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      message: `Gateway rejected the request (${response.status})`,
    });
  }

  // The daemon's confirmed state arrives asynchronously as dispatch_state over
  // the workspace socket — this only says the command was delivered.
  return { ok: true as const, requestId: input.requestId };
}
