import type { RouterRecord } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

import { eq, and, gt } from "@gmacko/ooda/db";
import { runnerDevice, runnerSession, sessionEvent } from "@gmacko/ooda/db/schema";

import { publicProcedure, runnerProcedure } from "../trpc";

export const runnerRouter = {
  register: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/register", tags: ["runner"], protect: true } })
    .input(
      z.object({
        name: z.string(),
        hostname: z.string().optional(),
        capabilities: z.array(z.string()).default([]),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      // Upsert by name — avoid creating duplicate devices on runner restart
      const existing = await ctx.db.query.runnerDevice.findFirst({
        where: eq(runnerDevice.name, input.name),
      });
      if (existing) {
        return ctx.db
          .update(runnerDevice)
          .set({
            hostname: input.hostname,
            capabilities: input.capabilities,
            lastHeartbeatAt: new Date(),
            status: "online",
          })
          .where(eq(runnerDevice.id, existing.id))
          .returning();
      }
      return ctx.db
        .insert(runnerDevice)
        .values({
          name: input.name,
          hostname: input.hostname,
          capabilities: input.capabilities,
          lastHeartbeatAt: new Date(),
        })
        .returning();
    }),

  heartbeat: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/heartbeat", tags: ["runner"], protect: true } })
    .input(z.object({ runnerId: z.string() }))
    .output(z.any())
    .mutation(({ ctx, input }) => {
      return ctx.db
        .update(runnerDevice)
        .set({
          lastHeartbeatAt: new Date(),
          status: "online",
        })
        .where(eq(runnerDevice.id, input.runnerId))
        .returning();
    }),

  listDevices: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/devices", tags: ["runner"] } })
    .output(z.any())
    .query(({ ctx }) => {
    return ctx.db.query.runnerDevice.findMany();
  }),

  createSession: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/sessions", tags: ["runner"], protect: true } })
    .input(
      z.object({
        threadId: z.string(),
        runnerId: z.string(),
        adapterId: z.string(),
        toolProfileId: z.string(),
        comparisonId: z.string().optional(),
      }),
    )
    .output(z.any())
    .mutation(({ ctx, input }) => {
      return ctx.db
        .insert(runnerSession)
        .values(input)
        .returning();
    }),

  listSessions: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/sessions", tags: ["runner"] } })
    .input(z.object({ threadId: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.runnerSession.findMany({
        where: eq(runnerSession.threadId, input.threadId),
      });
    }),

  listSessionsByRunner: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/sessions/by-runner", tags: ["runner"] } })
    .input(z.object({ runnerId: z.string() }))
    .output(z.any())
    .query(({ ctx, input }) => {
      return ctx.db.query.runnerSession.findMany({
        where: eq(runnerSession.runnerId, input.runnerId),
      });
    }),

  sendPrompt: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/send-prompt", tags: ["runner"], protect: true } })
    .input(
      z.object({
        threadId: z.string(),
        runnerId: z.string(),
        adapterId: z.string(),
        toolProfileId: z.string(),
        prompt: z.string().min(1),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      // Create session record
      const [session] = await ctx.db
        .insert(runnerSession)
        .values({
          threadId: input.threadId,
          runnerId: input.runnerId,
          adapterId: input.adapterId,
          toolProfileId: input.toolProfileId,
          status: "pending",
        })
        .returning();

      // Store the prompt as the first event
      if (session) {
        await ctx.db.insert(sessionEvent).values({
          sessionId: session.id,
          type: "prompt",
          content: input.prompt,
        });
      }

      return session;
    }),

  getSessionEvents: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/session-events", tags: ["runner"] } })
    .input(
      z.object({
        sessionId: z.string(),
        afterId: z.string().optional(),
      }),
    )
    .output(z.any())
    .query(async ({ ctx, input }) => {
      // Build WHERE conditions
      const conditions = [eq(sessionEvent.sessionId, input.sessionId)];

      // If afterId, find its createdAt and filter in SQL
      if (input.afterId) {
        const afterEvent = await ctx.db.query.sessionEvent.findFirst({
          where: eq(sessionEvent.id, input.afterId),
        });
        if (afterEvent?.createdAt) {
          conditions.push(gt(sessionEvent.createdAt, afterEvent.createdAt));
        }
      }

      return ctx.db.query.sessionEvent.findMany({
        where: and(...conditions),
        orderBy: sessionEvent.createdAt,
      });
    }),

  pushSessionEvent: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/session-events", tags: ["runner"], protect: true } })
    .input(
      z.object({
        sessionId: z.string(),
        type: z.string(),
        content: z.string(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const [event] = await ctx.db
        .insert(sessionEvent)
        .values(input)
        .returning();
      return event;
    }),

  claimSession: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/claim-session", tags: ["runner"], protect: true } })
    .input(z.object({ sessionId: z.string() }))
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      // Atomically claim: UPDATE WHERE status='pending' ensures only one caller wins
      const [claimed] = await ctx.db
        .update(runnerSession)
        .set({ status: "running", startedAt: new Date() })
        .where(
          and(
            eq(runnerSession.id, input.sessionId),
            eq(runnerSession.status, "pending"),
          ),
        )
        .returning();
      return claimed ?? null;
    }),

  updateSessionStatus: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/update-session-status", tags: ["runner"], protect: true } })
    .input(
      z.object({
        sessionId: z.string(),
        status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
        exitCode: z.number().optional(),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = { status: input.status };
      if (input.status === "running") {
        updates.startedAt = new Date();
      }
      if (input.status === "completed" || input.status === "failed") {
        updates.completedAt = new Date();
        if (input.exitCode !== undefined) updates.exitCode = input.exitCode;
      }
      return ctx.db
        .update(runnerSession)
        .set(updates)
        .where(eq(runnerSession.id, input.sessionId))
        .returning();
    }),

  getHealth: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/health", tags: ["runner"] } })
    .output(z.any())
    .query((): {
    connectorId: string;
    status: "up" | "degraded" | "down" | "unknown";
    rateLimitRemaining: number | undefined;
    lastSuccessAt: string | undefined;
    errorCount: number;
    avgResponseMs: number | undefined;
  }[] => {
    // Static placeholder data until wired to runner's HealthTracker via session event stream
    return [
      {
        connectorId: "reddit",
        status: "up",
        rateLimitRemaining: 87,
        lastSuccessAt: new Date().toISOString(),
        errorCount: 0,
        avgResponseMs: 245,
      },
      {
        connectorId: "hacker-news",
        status: "up",
        rateLimitRemaining: undefined,
        lastSuccessAt: new Date().toISOString(),
        errorCount: 0,
        avgResponseMs: 120,
      },
      {
        connectorId: "crossref",
        status: "degraded",
        rateLimitRemaining: 3,
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
        errorCount: 1,
        avgResponseMs: 890,
      },
      {
        connectorId: "semantic-scholar",
        status: "up",
        rateLimitRemaining: 42,
        lastSuccessAt: new Date().toISOString(),
        errorCount: 0,
        avgResponseMs: 310,
      },
    ];
  }),

  listAdapters: publicProcedure
    .meta({ openapi: { method: "GET", path: "/api/runner/adapters", tags: ["runner"] } })
    .input(z.object({ runnerId: z.string() }))
    .output(z.any())
    .query(async ({ ctx, input }) => {
      const device = await ctx.db.query.runnerDevice.findFirst({
        where: eq(runnerDevice.id, input.runnerId),
      });
      return (device?.capabilities ?? []) as string[];
    }),

  requestPromotion: runnerProcedure
    .meta({ openapi: { method: "POST", path: "/api/runner/request-promotion", tags: ["runner"], protect: true } })
    .input(
      z.object({
        sessionId: z.string(),
        runnerId: z.string(),
        threadId: z.string(),
        kind: z.enum(["observation", "hypothesis", "action", "reflection", "source-extract"]),
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .output(z.any())
    .mutation(async ({ ctx, input }) => {
      // Store as a pending promotion event
      const [event] = await ctx.db
        .insert(sessionEvent)
        .values({
          sessionId: input.sessionId,
          type: "promote_request",
          content: JSON.stringify({
            kind: input.kind,
            title: input.title,
            content: input.content,
            threadId: input.threadId,
            runnerId: input.runnerId,
          }),
        })
        .returning();
      return event;
    }),
} satisfies RouterRecord;
