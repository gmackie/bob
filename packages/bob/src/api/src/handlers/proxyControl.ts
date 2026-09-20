/**
 * Act on the inference proxy from the UI.
 *
 * Like dispatchControl, this API touches nothing itself. It authorises the
 * caller and relays to the ws-gateway, which forwards to the workspace's
 * daemon; the daemon holds the proxy's management key and does the work. The
 * key never passes through here, and the result comes back asynchronously as
 * a `proxy_control_result` frame on the workspace socket followed by a fresh
 * host snapshot.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { workspaces } from "@bob/db/schema";

export const PROXY_CONTROL_ACTIONS = ["refresh", "enable", "disable", "test"] as const;
export type ProxyControlActionId = (typeof PROXY_CONTROL_ACTIONS)[number];

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

/** Enabling an account spends the owner's subscription, so owner-only. */
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
      message: "Only the workspace owner can change the inference proxy",
    });
  }
}

export async function proxyControlSet(
  ctx: Ctx,
  input: { workspaceId: string; action: ProxyControlActionId; accountId?: string; requestId: string },
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
    response = await fetch(`${gatewayUrl}/internal/proxy-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        action: input.action,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        requestId: input.requestId,
      }),
    });
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gateway unreachable" });
  }

  if (response.status === 503) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The host daemon is not connected. Proxy control needs the node online.",
    });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: response.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      message: `Gateway rejected the request (${response.status})`,
    });
  }

  // The proxy's answer arrives asynchronously as proxy_control_result over the
  // workspace socket — this only says the command was delivered.
  return { ok: true as const, requestId: input.requestId };
}
