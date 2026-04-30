/**
 * Terminal handler functions — pure business logic extracted from the tRPC
 * terminal router.
 *
 * Phase 7B-4D-beta Task 3.
 */
import { TRPCError } from "@trpc/server";
import { eq, and } from "@bob/db";
import { agentInstances } from "@bob/db/schema";

import type { HandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function terminalCreateAgentSession(
  ctx: HandlerContext,
  input: { instanceId: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.instanceId),
      eq(agentInstances.userId, ctx.userId)
    ),
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  if (instance.status !== "running") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot connect to agent terminal. Instance is ${instance.status}. Please start the instance first.`,
    });
  }

  return {
    sessionId: crypto.randomUUID(),
    instanceId: input.instanceId,
    agentType: instance.agentType,
  };
}

export async function terminalCreateDirectorySession(
  ctx: HandlerContext,
  input: { instanceId: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.instanceId),
      eq(agentInstances.userId, ctx.userId)
    ),
    with: {
      worktree: true,
    },
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  return {
    sessionId: crypto.randomUUID(),
    instanceId: input.instanceId,
    path: instance.worktree?.path ?? "",
  };
}

export async function terminalCreateSystemSession(
  _ctx: HandlerContext,
  input: { cwd?: string; initialCommand?: string },
) {
  return {
    sessionId: crypto.randomUUID(),
    cwd: input.cwd ?? process.env.HOME ?? "/",
    initialCommand: input.initialCommand,
  };
}

export async function terminalListByInstance(
  ctx: HandlerContext,
  input: { instanceId: string },
) {
  const instance = await ctx.db.query.agentInstances.findFirst({
    where: and(
      eq(agentInstances.id, input.instanceId),
      eq(agentInstances.userId, ctx.userId)
    ),
  });

  if (!instance) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found" });
  }

  return [];
}

export async function terminalClose(
  _ctx: HandlerContext,
  _input: { sessionId: string },
) {
  return { success: true };
}
