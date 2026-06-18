import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod/v4";

import { workflowStatusValues } from "../services/sessions/workflowStatusService";
import {
  sessionList,
  sessionGet,
  sessionCreate,
  sessionBootstrapForChat,
  sessionUpdateTitle,
  sessionStop,
  sessionDelete,
  sessionGetEvents,
  sessionGetConnections,
  sessionSendHeadlessInput,
  sessionUpdateStatus,
  sessionClaimLease,
  sessionReleaseLease,
  sessionRecordEvent,
  sessionRecordEventBatch,
  getGatewaySocketUrl,
  sessionReportWorkflowStatus,
  sessionReportTaskProgress,
  sessionLinkTaskArtifact,
  sessionMarkTaskReviewReady,
  sessionRecordVerificationResult,
  sessionCompleteTask,
  sessionRequestInput,
  sessionResolveAwaitingInput,
  sessionGetWorkflowState,
  sessionCreateVoiceSession,
  sessionStopVoiceSession,
  sessionHandleVoiceTranscript,
} from "../handlers/session";
import { protectedProcedure } from "../trpc";

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
    .query(({ ctx, input }) =>
      sessionList({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      sessionGet({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionCreate({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionBootstrapForChat({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  updateTitle: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().max(256),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionUpdateTitle({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  stop: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      sessionStop({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      sessionDelete({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getEvents: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        fromSeq: z.number().optional(),
        toSeq: z.number().optional(),
        limit: z.number().min(1).max(1000).default(100),
      }),
    )
    .query(({ ctx, input }) =>
      sessionGetEvents({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getConnections: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      sessionGetConnections({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  sendHeadlessInput: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        message: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionSendHeadlessInput({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionUpdateStatus({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  claimLease: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        gatewayId: z.string(),
        leaseMs: z.number().min(1000).max(300000).default(30000),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionClaimLease({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  releaseLease: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      sessionReleaseLease({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionRecordEvent({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionRecordEventBatch({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getGatewayWebSocketUrl: protectedProcedure.query(({ ctx }) => ({
    url: getGatewaySocketUrl(),
    token: ctx.session.session?.token ?? "",
  })),

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
    .mutation(({ ctx, input }) =>
      sessionReportWorkflowStatus({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  reportTaskProgress: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        message: z.string().min(1),
        phase: z.string().optional(),
        progress: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionReportTaskProgress({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionLinkTaskArtifact({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  markTaskReviewReady: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        prUrl: z.string().url(),
        summary: z.string().min(1),
        notesForReviewer: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionMarkTaskReviewReady({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  recordVerificationResult: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        result: z.enum(["passed", "failed"]),
        summary: z.string().min(1),
        artifactUrl: z.string().url().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionRecordVerificationResult({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  completeTask: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        summary: z.string().min(1),
        prUrl: z.string().url().optional(),
        markIssueDone: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionCompleteTask({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionRequestInput({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

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
    .mutation(({ ctx, input }) =>
      sessionResolveAwaitingInput({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  getWorkflowState: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      sessionGetWorkflowState({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  createVoiceSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      sessionCreateVoiceSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  stopVoiceSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      sessionStopVoiceSession({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),

  handleVoiceTranscript: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        transcript: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      sessionHandleVoiceTranscript({ db: ctx.db, userId: ctx.session.user.id }, input),
    ),
} satisfies TRPCRouterRecord;
