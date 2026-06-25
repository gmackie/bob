/**
 * Effect-RPC handler functions for the session RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 10.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
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
  sessionGetGatewayWebSocketUrl,
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
} from "../handlers/session.js";

export const makeSessionRpcHandlers = (ctx: HandlerContext) => ({
  "session.list": ({
    payload,
  }: {
    payload: Parameters<typeof sessionList>[1];
  }) => wrapHandler(sessionList, ctx, payload, "session"),

  "session.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(sessionGet, ctx, payload, "session"),

  "session.create": ({
    payload,
  }: {
    payload: {
      repositoryId?: string;
      worktreeId?: string;
      workingDirectory: string;
      agentType?: string;
      title?: string;
      personaId?: string;
    };
  }) => wrapHandler(sessionCreate, ctx, payload, "session"),

  "session.bootstrapForChat": ({
    payload,
  }: {
    payload: {
      repositoryId?: string;
      worktreeId?: string;
      workingDirectory: string;
      agentType?: string;
      title?: string;
      personaId?: string;
    };
  }) => wrapHandler(sessionBootstrapForChat, ctx, payload, "session"),

  "session.updateTitle": ({
    payload,
  }: {
    payload: { id: string; title: string };
  }) => wrapHandler(sessionUpdateTitle, ctx, payload, "session"),

  "session.stop": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(sessionStop, ctx, payload, "session"),

  "session.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapHandler(sessionDelete, ctx, payload, "session"),

  "session.getEvents": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      fromSeq?: number;
      toSeq?: number;
      limit: number;
    };
  }) => wrapHandler(sessionGetEvents, ctx, payload, "session"),

  "session.getConnections": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(sessionGetConnections, ctx, payload, "session"),

  "session.sendHeadlessInput": ({
    payload,
  }: {
    payload: { sessionId: string; message: string };
  }) => wrapHandler(sessionSendHeadlessInput, ctx, payload, "session"),

  "session.updateStatus": ({
    payload,
  }: {
    payload: Parameters<typeof sessionUpdateStatus>[1];
  }) => wrapHandler(sessionUpdateStatus, ctx, payload, "session"),

  "session.claimLease": ({
    payload,
  }: {
    payload: { sessionId: string; gatewayId: string; leaseMs: number };
  }) => wrapHandler(sessionClaimLease, ctx, payload, "session"),

  "session.releaseLease": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(sessionReleaseLease, ctx, payload, "session"),

  "session.recordEvent": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      seq: number;
      direction: "client" | "agent" | "system";
      eventType: string;
      payload: Record<string, unknown>;
    };
  }) => wrapHandler(sessionRecordEvent, ctx, payload, "session"),

  "session.recordEventBatch": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      events: Array<{
        seq: number;
        direction: "client" | "agent" | "system";
        eventType: string;
        payload: Record<string, unknown>;
      }>;
    };
  }) => wrapHandler(sessionRecordEventBatch, ctx, payload, "session"),

  "session.getGatewayWebSocketUrl": ({
    payload,
  }: {
    payload: void;
  }) => wrapHandler(sessionGetGatewayWebSocketUrl, ctx, payload, "session"),

  "session.reportWorkflowStatus": ({
    payload,
  }: {
    payload: Parameters<typeof sessionReportWorkflowStatus>[1];
  }) => wrapHandler(sessionReportWorkflowStatus, ctx, payload, "session"),

  "session.reportTaskProgress": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      message: string;
      phase?: string;
      progress?: string;
    };
  }) => wrapHandler(sessionReportTaskProgress, ctx, payload, "session"),

  "session.linkTaskArtifact": ({
    payload,
  }: {
    payload: Parameters<typeof sessionLinkTaskArtifact>[1];
  }) => wrapHandler(sessionLinkTaskArtifact, ctx, payload, "session"),

  "session.markTaskReviewReady": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      prUrl: string;
      summary: string;
      notesForReviewer?: string;
    };
  }) => wrapHandler(sessionMarkTaskReviewReady, ctx, payload, "session"),

  "session.recordVerificationResult": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      result: "passed" | "failed";
      summary: string;
      artifactUrl?: string;
    };
  }) => wrapHandler(sessionRecordVerificationResult, ctx, payload, "session"),

  "session.completeTask": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      summary: string;
      prUrl?: string;
      markIssueDone?: boolean;
    };
  }) => wrapHandler(sessionCompleteTask, ctx, payload, "session"),

  "session.requestInput": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      question: string;
      options?: string[];
      defaultAction: string;
      timeoutMinutes?: number;
    };
  }) => wrapHandler(sessionRequestInput, ctx, payload, "session"),

  "session.resolveAwaitingInput": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      resolution: { type: "human" | "timeout"; value: string };
    };
  }) => wrapHandler(sessionResolveAwaitingInput, ctx, payload, "session"),

  "session.getWorkflowState": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(sessionGetWorkflowState, ctx, payload, "session"),

  "session.createVoiceSession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(sessionCreateVoiceSession, ctx, payload, "session"),

  "session.stopVoiceSession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapHandler(sessionStopVoiceSession, ctx, payload, "session"),

  "session.handleVoiceTranscript": ({
    payload,
  }: {
    payload: { sessionId: string; transcript: string };
  }) => wrapHandler(sessionHandleVoiceTranscript, ctx, payload, "session"),
});
