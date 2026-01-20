import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, count, desc, eq, gt, lt, sql } from "@bob/db";
import {
  chatConversations,
  sessionConnections,
  sessionEvents,
} from "@bob/db/schema";

import type { WorkflowStatus } from "../services/sessions/workflowStatusService";
import type { ElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import {
  getSessionWorkflowState,
  reportWorkflowStatus,
  requestInput,
  resolveAwaitingInput,
  workflowStatusValues,
} from "../services/sessions/workflowStatusService";
import { createElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";

// Initialize ElevenLabs session service (singleton)
let elevenlabsService: ElevenLabsSessionService | null = null;
function getElevenLabsService(): ElevenLabsSessionService | null {
  if (!elevenlabsService) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;

    if (!apiKey || !agentId) {
      console.warn(
        "[Session] ElevenLabs not configured: ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID required",
      );
      return null;
    }

    elevenlabsService = createElevenLabsSessionService({
      apiKey,
      agentId,
    });
  }
  return elevenlabsService;
}

const sessionStatusValues = [
  "provisioning",
  "starting",
  "running",
  "idle",
  "stopping",
  "stopped",
  "error",
] as const;

export const sessionRouter = {
  list: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid().optional(),
        worktreeId: z.string().uuid().optional(),
        status: z.enum(sessionStatusValues).optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(chatConversations.userId, ctx.session.user.id)];

      if (input.repositoryId) {
        conditions.push(eq(chatConversations.repositoryId, input.repositoryId));
      }
      if (input.worktreeId) {
        conditions.push(eq(chatConversations.worktreeId, input.worktreeId));
      }
      if (input.status) {
        conditions.push(eq(chatConversations.status, input.status));
      }

      const sessions = await ctx.db
        .select({
          id: chatConversations.id,
          title: chatConversations.title,
          repositoryId: chatConversations.repositoryId,
          worktreeId: chatConversations.worktreeId,
          workingDirectory: chatConversations.workingDirectory,
          agentType: chatConversations.agentType,
          status: chatConversations.status,
          nextSeq: chatConversations.nextSeq,
          lastActivityAt: chatConversations.lastActivityAt,
          lastError: chatConversations.lastError,
          createdAt: chatConversations.createdAt,
          updatedAt: chatConversations.updatedAt,
        })
        .from(chatConversations)
        .where(and(...conditions))
        .orderBy(desc(chatConversations.updatedAt))
        .limit(input.limit + 1);

      const hasMore = sessions.length > input.limit;
      const items = hasMore ? sessions.slice(0, -1) : sessions;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return {
        items,
        nextCursor,
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.id),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
        with: {
          repository: true,
          worktree: true,
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      return session;
    }),

  create: protectedProcedure
    .input(
      z.object({
        repositoryId: z.string().uuid().optional(),
        worktreeId: z.string().uuid().optional(),
        workingDirectory: z.string(),
        agentType: z.string().default("opencode"),
        title: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .insert(chatConversations)
        .values({
          userId: ctx.session.user.id,
          repositoryId: input.repositoryId ?? null,
          worktreeId: input.worktreeId ?? null,
          workingDirectory: input.workingDirectory,
          agentType: input.agentType,
          title: input.title ?? null,
          status: "provisioning",
        })
        .returning();

      return session;
    }),

  updateTitle: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(chatConversations)
        .set({ title: input.title })
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.userId, ctx.session.user.id),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      return updated;
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.id),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const [updated] = await ctx.db
        .update(chatConversations)
        .set({
          status: "stopped",
          claimedByGatewayId: null,
          leaseExpiresAt: null,
        })
        .where(eq(chatConversations.id, input.id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chatConversations)
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  getEvents: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        fromSeq: z.number().optional(),
        toSeq: z.number().optional(),
        limit: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const conditions = [eq(sessionEvents.sessionId, input.sessionId)];
      if (input.fromSeq !== undefined) {
        conditions.push(gt(sessionEvents.seq, input.fromSeq));
      }
      if (input.toSeq !== undefined) {
        conditions.push(lt(sessionEvents.seq, input.toSeq));
      }

      const events = await ctx.db
        .select()
        .from(sessionEvents)
        .where(and(...conditions))
        .orderBy(asc(sessionEvents.seq))
        .limit(input.limit);

      return {
        events,
        latestSeq: session.nextSeq - 1,
      };
    }),

  getConnections: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const connections = await ctx.db
        .select()
        .from(sessionConnections)
        .where(eq(sessionConnections.sessionId, input.sessionId))
        .orderBy(desc(sessionConnections.connectedAt));

      return connections;
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(sessionStatusValues),
        lastError: z
          .object({
            code: z.string(),
            message: z.string(),
            timestamp: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(chatConversations)
        .set({
          status: input.status,
          lastError: input.lastError,
          lastActivityAt: new Date(),
        })
        .where(
          and(
            eq(chatConversations.id, input.id),
            eq(chatConversations.userId, ctx.session.user.id),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      return updated;
    }),

  claimLease: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        gatewayId: z.string(),
        leaseMs: z.number().min(1000).max(300000).default(30000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const canClaim =
        !session.claimedByGatewayId ||
        session.claimedByGatewayId === input.gatewayId ||
        (session.leaseExpiresAt && session.leaseExpiresAt < new Date());

      if (!canClaim) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Session claimed by gateway ${session.claimedByGatewayId}`,
        });
      }

      const [updated] = await ctx.db
        .update(chatConversations)
        .set({
          claimedByGatewayId: input.gatewayId,
          leaseExpiresAt: new Date(Date.now() + input.leaseMs),
        })
        .where(eq(chatConversations.id, input.sessionId))
        .returning();

      return updated;
    }),

  releaseLease: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(chatConversations)
        .set({
          claimedByGatewayId: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(chatConversations.id, input.sessionId),
            eq(chatConversations.userId, ctx.session.user.id),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      return updated;
    }),

  recordEvent: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        seq: z.number(),
        direction: z.enum(["client", "agent", "system"]),
        eventType: z.string(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const [event] = await ctx.db
        .insert(sessionEvents)
        .values({
          sessionId: input.sessionId,
          seq: input.seq,
          direction: input.direction,
          eventType: input.eventType,
          payload: input.payload,
        })
        .returning();

      await ctx.db
        .update(chatConversations)
        .set({
          nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${input.seq + 1})`,
          lastActivityAt: new Date(),
        })
        .where(eq(chatConversations.id, input.sessionId));

      return event;
    }),

  recordEventBatch: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        events: z.array(
          z.object({
            seq: z.number(),
            direction: z.enum(["client", "agent", "system"]),
            eventType: z.string(),
            payload: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.events.length === 0) return { count: 0 };

      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const eventsToInsert = input.events.map((e) => ({
        sessionId: input.sessionId,
        seq: e.seq,
        direction: e.direction,
        eventType: e.eventType,
        payload: e.payload,
      }));

      await ctx.db.insert(sessionEvents).values(eventsToInsert);

      const maxSeq = Math.max(...input.events.map((e) => e.seq));
      await ctx.db
        .update(chatConversations)
        .set({
          nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${maxSeq + 1})`,
          lastActivityAt: new Date(),
        })
        .where(eq(chatConversations.id, input.sessionId));

      return { count: input.events.length };
    }),

  getGatewayWebSocketUrl: protectedProcedure.query(async () => {
    const wsUrl = GATEWAY_URL.replace(/^http/, "ws");
    return {
      url: `${wsUrl}/sessions`,
    };
  }),

  reportWorkflowStatus: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        status: z.enum(workflowStatusValues),
        message: z.string(),
        details: z
          .object({
            phase: z.string().optional(),
            progress: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await reportWorkflowStatus(ctx.session.user.id, {
          sessionId: input.sessionId,
          status: input.status,
          message: input.message,
          details: input.details,
        });
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update workflow status",
        });
      }
    }),

  requestInput: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        question: z.string(),
        options: z.array(z.string()).optional(),
        defaultAction: z.string(),
        timeoutMinutes: z.number().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await requestInput(ctx.session.user.id, {
          sessionId: input.sessionId,
          question: input.question,
          options: input.options,
          defaultAction: input.defaultAction,
          timeoutMinutes: input.timeoutMinutes,
        });
        return result;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to request input",
        });
      }
    }),

  resolveAwaitingInput: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        resolution: z.object({
          type: z.enum(["human", "timeout"]),
          value: z.string(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await resolveAwaitingInput(ctx.session.user.id, {
          sessionId: input.sessionId,
          resolution: input.resolution,
        });
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to resolve awaiting input",
        });
      }
    }),

  getWorkflowState: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const state = await getSessionWorkflowState(
        ctx.session.user.id,
        input.sessionId,
      );
      if (!state) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }
      return state;
    }),

  createVoiceSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = getElevenLabsService();
      if (!service) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ElevenLabs service not configured",
        });
      }

      // Verify session belongs to user
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      if (session.agentType !== "elevenlabs") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Session agent type must be 'elevenlabs'",
        });
      }

      const voiceSession = await service.createVoiceSession(input.sessionId);

      // Register transcript callback to persist events
      service.onTranscript(input.sessionId, async (event) => {
        const nextSeq = session.nextSeq;
        await ctx.db.insert(sessionEvents).values({
          sessionId: input.sessionId,
          seq: nextSeq,
          direction: event.type === "user" ? "client" : "agent",
          eventType: "transcript",
          payload: {
            type: event.type,
            text: event.text,
            timestamp: event.timestamp.toISOString(),
          },
        });

        await ctx.db
          .update(chatConversations)
          .set({
            nextSeq: sql`GREATEST(${chatConversations.nextSeq}, ${nextSeq + 1})`,
            lastActivityAt: new Date(),
          })
          .where(eq(chatConversations.id, input.sessionId));
      });

      return voiceSession;
    }),

  stopVoiceSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = getElevenLabsService();
      if (!service) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ElevenLabs service not configured",
        });
      }

      // Verify session belongs to user
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      await service.stopVoiceSession(input.sessionId);
      return { success: true };
    }),

  handleVoiceTranscript: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        transcript: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const service = getElevenLabsService();
      if (!service) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "ElevenLabs service not configured",
        });
      }

      // Verify session belongs to user
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      const assistantText = await service.handleUserTranscript(
        input.sessionId,
        input.transcript,
      );

      return { assistantText };
    }),
} satisfies TRPCRouterRecord;
