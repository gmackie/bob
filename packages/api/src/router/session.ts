import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, asc, count, desc, eq, gt, inArray, lt, sql } from "@bob/db";
import {
  chatConversations,
  sessionConnections,
  sessionEvents,
  taskRuns,
} from "@bob/db/schema";

import type { WorkflowStatus } from "../services/sessions/workflowStatusService";
import type { ElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import {
  completeTask,
  getSessionWorkflowState,
  linkTaskArtifact,
  markTaskReviewReady,
  recordVerificationResult,
  reportTaskProgress,
  reportWorkflowStatus,
  requestInput,
  resolveAwaitingInput,
  workflowStatusValues,
} from "../services/sessions/workflowStatusService";
import { createElevenLabsSessionService } from "../services/voice/elevenlabsSession";
import { createOpenCodeClient } from "../services/opencode/opencodeClient";
import { buildPlanningWorkItemUrl } from "../services/integrations/planningRemoteConfig";
import { protectedProcedure } from "../trpc";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:3002";
const getGatewaySocketUrl = (): string => `${GATEWAY_URL.replace(/^http/, "ws")}/sessions`;

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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

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
          workItemId: chatConversations.workItemId,
          workItemIdentifierSnapshot: chatConversations.workItemIdentifierSnapshot,
          planningTaskId: chatConversations.planningTaskId,
        })
        .from(chatConversations)
        .where(and(...conditions))
        .orderBy(desc(chatConversations.updatedAt))
        .limit(input.limit + 1);

      const hasMore = sessions.length > input.limit;
      const items = hasMore ? sessions.slice(0, -1) : sessions;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
      const sessionIds = items.map((session) => session.id);
      const linkedTaskRows =
        sessionIds.length > 0
          ? await ctx.db
              .select({
                sessionId: taskRuns.sessionId,
                workItemId: taskRuns.workItemId,
                workItemIdentifierSnapshot: taskRuns.workItemIdentifierSnapshot,
                planningItemId: taskRuns.planningItemId,
                planningItemIdentifier: taskRuns.planningItemIdentifier,
              })
              .from(taskRuns)
              .where(inArray(taskRuns.sessionId, sessionIds))
              .orderBy(desc(taskRuns.createdAt))
          : [];
      const linkedTaskBySessionId = new Map<
        string,
        { id: string; identifier: string; url: string | null }
      >();

      for (const row of linkedTaskRows) {
        if (!row.sessionId || linkedTaskBySessionId.has(row.sessionId)) {
          continue;
        }

        const workItemId = row.workItemId ?? row.planningItemId;
        const workItemIdentifier =
          row.workItemIdentifierSnapshot ?? row.planningItemIdentifier;

        linkedTaskBySessionId.set(row.sessionId, {
          id: workItemId,
          identifier: workItemIdentifier,
          url: buildPlanningWorkItemUrl(workItemId),
        });
      }

      return {
        items: items.map((session) => ({
          ...session,
          workItemId: session.workItemId ?? session.planningTaskId,
          workItemIdentifier:
            session.workItemIdentifierSnapshot ??
            linkedTaskBySessionId.get(session.id)?.identifier ??
            null,
          linkedTask: linkedTaskBySessionId.get(session.id) ?? null,
          issueManaged: Boolean(session.workItemId ?? session.planningTaskId),
          planningTaskId: session.planningTaskId,
        })),
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

      const latestTaskRun = await ctx.db.query.taskRuns.findFirst({
        where: and(
          eq(taskRuns.sessionId, session.id),
          eq(taskRuns.userId, ctx.session.user.id),
        ),
        orderBy: desc(taskRuns.createdAt),
      });

      return {
        ...session,
        workItemId:
          session.workItemId ??
          latestTaskRun?.workItemId ??
          session.planningTaskId,
        workItemIdentifier:
          session.workItemIdentifierSnapshot ??
          latestTaskRun?.workItemIdentifierSnapshot ??
          latestTaskRun?.planningItemIdentifier ??
          null,
        linkedTask: latestTaskRun
          ? {
              id: latestTaskRun.workItemId ?? latestTaskRun.planningItemId,
              identifier:
                latestTaskRun.workItemIdentifierSnapshot ??
                latestTaskRun.planningItemIdentifier,
              url: buildPlanningWorkItemUrl(
                latestTaskRun.workItemId ?? latestTaskRun.planningItemId,
              ),
            }
          : null,
        issueManaged: Boolean(
          session.workItemId ??
            latestTaskRun?.workItemId ??
            session.planningTaskId,
        ),
        planningTaskId: session.planningTaskId,
      };
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

  bootstrapForChat: protectedProcedure
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

      if (!session) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create chat session",
        });
      }

      return {
        ...session,
        gateway: {
          url: getGatewaySocketUrl(),
          shouldStartOnConnect: true,
        },
      };
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

  sendHeadlessInput: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.db.query.chatConversations.findFirst({
        where: and(
          eq(chatConversations.id, input.sessionId),
          eq(chatConversations.userId, ctx.session.user.id),
        ),
        columns: {
          status: true,
          agentType: true,
          opencodeSessionId: true,
          nextSeq: true,
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      if (session.agentType !== "opencode") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Headless mode currently supports opencode sessions only",
        });
      }

      const opencodeClient = createOpenCodeClient();
      let opencodeSessionId = session.opencodeSessionId;

      if (!opencodeSessionId?.trim()) {
        const created = await opencodeClient.createSession({
          bobConversationId: input.sessionId,
        });
        opencodeSessionId = created.id;

        await ctx.db.update(chatConversations).set({
          opencodeSessionId,
        }).where(eq(chatConversations.id, input.sessionId));
      }

      const [updatedSession] = await ctx.db
        .update(chatConversations)
        .set({
          status: "running",
          lastActivityAt: new Date(),
          nextSeq: sql`${chatConversations.nextSeq} + 2`,
        })
        .where(eq(chatConversations.id, input.sessionId))
        .returning({ nextSeq: chatConversations.nextSeq });

      const inputSeq = (updatedSession?.nextSeq ?? session.nextSeq) - 2;
      const outputSeq = inputSeq + 1;

      await ctx.db.insert(sessionEvents).values({
        sessionId: input.sessionId,
        seq: inputSeq,
        direction: "client",
        eventType: "input",
        payload: { data: input.message },
      });

      try {
        let content = "";
        const stream = await opencodeClient.sendMessage(
          opencodeSessionId,
          {
            role: "user",
            content: input.message,
          },
          { stream: true },
        );

        for await (const chunk of stream) {
          content += chunk.content;
        }

        await ctx.db.insert(sessionEvents).values({
          sessionId: input.sessionId,
          seq: outputSeq,
          direction: "agent",
          eventType: "message_final",
          payload: {
            content,
          },
        });

        return {
          sessionId: input.sessionId,
          seq: { input: inputSeq, assistant: outputSeq },
        };
      } catch (error) {
        const errorMessage = toErrorMessage(error);

        await ctx.db.insert(sessionEvents).values({
          sessionId: input.sessionId,
          seq: outputSeq,
          direction: "system",
          eventType: "error",
          payload: { message: errorMessage },
        });

        await ctx.db
          .update(chatConversations)
          .set({
            status: "error",
            lastError: {
              code: "HEADLESS_INPUT_ERROR",
              message: errorMessage,
              timestamp: new Date().toISOString(),
            },
            lastActivityAt: new Date(),
          })
          .where(eq(chatConversations.id, input.sessionId));

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
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
    return {
      url: getGatewaySocketUrl(),
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

  reportTaskProgress: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        message: z.string().min(1),
        phase: z.string().optional(),
        progress: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await reportTaskProgress(ctx.session.user.id, input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to report task progress",
        });
      }
    }),

  linkTaskArtifact: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        artifactType: z.enum([
          "pr",
          "verification",
          "build",
          "test_report",
          "doc",
          "deliverable",
          "other",
        ]),
        artifactRole: z
          .enum([
            "primary",
            "review",
            "verification",
            "documentation",
            "deliverable",
            "build",
            "test_report",
            "other",
          ])
          .optional(),
        url: z.string().url(),
        title: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await linkTaskArtifact(ctx.session.user.id, input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to attach task artifact",
        });
      }
    }),

  markTaskReviewReady: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        prUrl: z.string().url(),
        summary: z.string().min(1),
        notesForReviewer: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await markTaskReviewReady(ctx.session.user.id, input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to mark task review ready",
        });
      }
    }),

  recordVerificationResult: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        result: z.enum(["passed", "failed"]),
        summary: z.string().min(1),
        artifactUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await recordVerificationResult(ctx.session.user.id, input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to record verification result",
        });
      }
    }),

  completeTask: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        summary: z.string().min(1),
        prUrl: z.string().url().optional(),
        markIssueDone: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await completeTask(ctx.session.user.id, input);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to complete task",
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
