import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { count, eq } from "@bob/db";
import { repositories, worktrees, agentInstances } from "@bob/db/schema";

import { protectedProcedure, publicProcedure } from "../trpc";

const agentInfoSchema = z.object({
  type: z.string(),
  name: z.string(),
  isAvailable: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
});

const systemStatusSchema = z.object({
  agents: z.array(agentInfoSchema),
  github: z.object({
    status: z.enum(["available", "not_available", "not_authenticated", "unknown"]),
    version: z.string(),
    user: z.string(),
  }),
  metrics: z.object({
    repositories: z.number(),
    worktrees: z.number(),
    totalInstances: z.number(),
    activeInstances: z.number(),
  }),
  server: z.object({
    uptime: z.number(),
    memory: z.object({
      rss: z.number(),
      heapTotal: z.number(),
      heapUsed: z.number(),
      external: z.number(),
    }),
    nodeVersion: z.string(),
  }),
});

export type SystemStatus = z.infer<typeof systemStatusSchema>;

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

export const systemRouter = {
  health: publicProcedure.query(() => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }),

  ensureContainer: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    try {
      const response = await fetch(`${GATEWAY_URL}/container/ensure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        throw new Error(`Gateway returned ${response.status}`);
      }

      const data = await response.json() as { status: string; port: number };
      return { 
        status: "ready", 
        port: data.port,
        gatewayUrl: GATEWAY_URL,
      };
    } catch (error) {
      console.error("Failed to ensure container:", error);
      return { 
        status: "error", 
        error: String(error),
      };
    }
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
