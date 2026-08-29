/**
 * Browser-driven agent re-authentication.
 *
 * Before this, a dead agent credential could only be fixed by SSHing to the
 * host and running a login script by hand, so an outage lasted as long as it
 * took someone to reach a terminal — the 2026-08-29 one ran eight days.
 *
 * The API does not touch credentials. It authorises the caller, then relays the
 * request to the ws-gateway, which forwards it to the workspace's daemon. The
 * daemon runs as the user that owns the credential files and lets the vendor
 * CLI write its own. No token ever passes through here.
 */

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { workspaces } from "@bob/db/schema";

export const AGENT_AUTH_PROVIDERS = ["claude", "codex", "grok", "cursor-agent"] as const;
export type AgentAuthProviderId = (typeof AGENT_AUTH_PROVIDERS)[number];

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
 * Starting a login mutates credential files on the host, and the verification
 * link that comes back is sensitive while it is live. Restrict both to the
 * workspace owner rather than any authenticated user.
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
      message: "Only the workspace owner can manage agent credentials",
    });
  }
}

type AgentAuthAction =
  | { action: "start"; requestId: string; provider: AgentAuthProviderId }
  | { action: "code"; requestId: string; value: string }
  | { action: "cancel"; requestId: string };

async function callGateway(
  workspaceId: string,
  payload: AgentAuthAction,
): Promise<{ ok: true }> {
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
    response = await fetch(`${gatewayUrl}/internal/agent-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ workspaceId, ...payload }),
    });
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Gateway unreachable" });
  }

  if (response.status === 503) {
    // The host is offline rather than the request being wrong — say so, so the
    // operator waits for the daemon instead of retrying a doomed sign-in.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The host daemon is not connected. Agent auth needs the node online.",
    });
  }
  if (!response.ok) {
    throw new TRPCError({
      code: response.status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      message: `Gateway rejected the request (${response.status})`,
    });
  }
  return { ok: true };
}

export async function agentAuthStart(
  ctx: Ctx,
  input: { workspaceId: string; provider: AgentAuthProviderId; requestId: string },
) {
  await assertWorkspaceOwner(ctx, input.workspaceId);
  await callGateway(input.workspaceId, {
    action: "start",
    requestId: input.requestId,
    provider: input.provider,
  });
  // The prompt (URL/code) arrives asynchronously over the workspace socket.
  return { ok: true as const, requestId: input.requestId };
}

export async function agentAuthSubmitCode(
  ctx: Ctx,
  input: { workspaceId: string; requestId: string; value: string },
) {
  await assertWorkspaceOwner(ctx, input.workspaceId);
  await callGateway(input.workspaceId, {
    action: "code",
    requestId: input.requestId,
    value: input.value,
  });
  return { ok: true as const };
}

export async function agentAuthCancel(
  ctx: Ctx,
  input: { workspaceId: string; requestId: string },
) {
  await assertWorkspaceOwner(ctx, input.workspaceId);
  await callGateway(input.workspaceId, { action: "cancel", requestId: input.requestId });
  return { ok: true as const };
}
