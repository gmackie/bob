/**
 * System handler functions — pure business logic extracted from the tRPC
 * system router.
 *
 * Phase 7B-4D-beta Task 2.
 */
import { count, eq } from "@bob/db";
import { repositories, worktrees, agentInstances } from "@bob/db/schema";

import type { HandlerContext, PublicHandlerContext } from "./context.js";

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

// Kept `async` (no real await) since rpc-handlers/system.ts wraps this via
// wrapHandler, which requires a Promise-returning fn.
export async function systemHealth(_ctx: PublicHandlerContext) {
  await Promise.resolve();
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

export async function systemStatus(ctx: HandlerContext, _input?: void) {
  const [repoCount] = await ctx.db
    .select({ count: count() })
    .from(repositories)
    .where(eq(repositories.userId, ctx.userId));

  const [worktreeCount] = await ctx.db
    .select({ count: count() })
    .from(worktrees)
    .where(eq(worktrees.userId, ctx.userId));

  const instances = await ctx.db
    .select()
    .from(agentInstances)
    .where(eq(agentInstances.userId, ctx.userId));

  const activeInstances = instances.filter(
    (i) => i.status === "running" || i.status === "starting",
  ).length;

  const memUsage = process.memoryUsage();

  return {
    agents: [],
    github: {
      status: "unknown" as const,
      version: "",
      user: "",
    },
    metrics: {
      repositories: repoCount?.count ?? 0,
      worktrees: worktreeCount?.count ?? 0,
      totalInstances: instances.length,
      activeInstances,
    },
    server: {
      uptime: process.uptime(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
      },
      nodeVersion: process.version,
    },
  };
}
