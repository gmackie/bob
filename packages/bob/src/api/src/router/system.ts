import type { TRPCRouterRecord } from "@trpc/server";

import { count, eq } from "@bob/db";
import { repositories, worktrees, agentInstances } from "@bob/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

export const systemRouter = {
  health: publicProcedure.query(() => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }),

  status: protectedProcedure.query(async ({ ctx }) => {
    const [repoCount] = await ctx.db
      .select({ count: count() })
      .from(repositories)
      .where(eq(repositories.userId, ctx.session.user.id));

    const [worktreeCount] = await ctx.db
      .select({ count: count() })
      .from(worktrees)
      .where(eq(worktrees.userId, ctx.session.user.id));

    const instances = await ctx.db
      .select()
      .from(agentInstances)
      .where(eq(agentInstances.userId, ctx.session.user.id));

    const activeInstances = instances.filter(
      (i) => i.status === "running" || i.status === "starting"
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
  }),
} satisfies TRPCRouterRecord;
