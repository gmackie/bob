/**
 * Effect-RPC handler functions for the session RPCs.
 *
 * Each handler accepts the RPC payload, delegates to the extracted handler
 * function via `wrapHandler`, and returns an Effect value.
 *
 * Phase 7B-4D-beta Task 10.
 */
import type { HandlerContext } from "../handlers/context.js";
import { wrapAuthorizedHandler } from "../handlers/authorized-rpc.js";
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
  }) => wrapAuthorizedHandler(sessionList, ctx, payload, "session"),

  "session.get": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapAuthorizedHandler(sessionGet, ctx, payload, "session"),

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
  }) => wrapAuthorizedHandler(sessionCreate, ctx, payload, "session"),

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
  }) => wrapAuthorizedHandler(sessionBootstrapForChat, ctx, payload, "session"),

  "session.updateTitle": ({
    payload,
  }: {
    payload: { id: string; title: string };
  }) => wrapAuthorizedHandler(sessionUpdateTitle, ctx, payload, "session"),

  "session.stop": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapAuthorizedHandler(sessionStop, ctx, payload, "session"),

  "session.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) => wrapAuthorizedHandler(sessionDelete, ctx, payload, "session"),

  "session.getEvents": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      fromSeq?: number;
      toSeq?: number;
      limit: number;
    };
  }) => wrapAuthorizedHandler(sessionGetEvents, ctx, payload, "session"),

  "session.getConnections": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(sessionGetConnections, ctx, payload, "session"),

  "session.sendHeadlessInput": ({
    payload,
  }: {
    payload: { sessionId: string; message: string };
  }) => wrapAuthorizedHandler(sessionSendHeadlessInput, ctx, payload, "session"),

  "session.updateStatus": ({
    payload,
  }: {
    payload: Parameters<typeof sessionUpdateStatus>[1];
  }) => wrapAuthorizedHandler(sessionUpdateStatus, ctx, payload, "session"),

  "session.claimLease": ({
    payload,
  }: {
    payload: { sessionId: string; gatewayId: string; leaseMs: number };
  }) => wrapAuthorizedHandler(sessionClaimLease, ctx, payload, "session"),

  "session.releaseLease": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(sessionReleaseLease, ctx, payload, "session"),

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
  }) => wrapAuthorizedHandler(sessionRecordEvent, ctx, payload, "session"),

  "session.recordEventBatch": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      events: {
        seq: number;
        direction: "client" | "agent" | "system";
        eventType: string;
        payload: Record<string, unknown>;
      }[];
    };
  }) => wrapAuthorizedHandler(sessionRecordEventBatch, ctx, payload, "session"),

  "session.getGatewayWebSocketUrl": ({
    payload,
  }: {
    payload: void;
  }) => wrapAuthorizedHandler(sessionGetGatewayWebSocketUrl, ctx, payload, "session"),

  "session.reportWorkflowStatus": ({
    payload,
  }: {
    payload: Parameters<typeof sessionReportWorkflowStatus>[1];
  }) => wrapAuthorizedHandler(sessionReportWorkflowStatus, ctx, payload, "session"),

  "session.reportTaskProgress": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      message: string;
      phase?: string;
      progress?: string;
    };
  }) => wrapAuthorizedHandler(sessionReportTaskProgress, ctx, payload, "session"),

  "session.linkTaskArtifact": ({
    payload,
  }: {
    payload: Parameters<typeof sessionLinkTaskArtifact>[1];
  }) => wrapAuthorizedHandler(sessionLinkTaskArtifact, ctx, payload, "session"),

  "session.markTaskReviewReady": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      prUrl: string;
      summary: string;
      notesForReviewer?: string;
    };
  }) => wrapAuthorizedHandler(sessionMarkTaskReviewReady, ctx, payload, "session"),

  "session.recordVerificationResult": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      result: "passed" | "failed";
      summary: string;
      artifactUrl?: string;
    };
  }) => wrapAuthorizedHandler(sessionRecordVerificationResult, ctx, payload, "session"),

  "session.completeTask": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      summary: string;
      prUrl?: string;
      markIssueDone?: boolean;
    };
  }) => wrapAuthorizedHandler(sessionCompleteTask, ctx, payload, "session"),

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
  }) => wrapAuthorizedHandler(sessionRequestInput, ctx, payload, "session"),

  "session.resolveAwaitingInput": ({
    payload,
  }: {
    payload: {
      sessionId: string;
      resolution: { type: "human" | "timeout"; value: string };
    };
  }) => wrapAuthorizedHandler(sessionResolveAwaitingInput, ctx, payload, "session"),

  "session.getWorkflowState": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(sessionGetWorkflowState, ctx, payload, "session"),

  "session.createVoiceSession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(sessionCreateVoiceSession, ctx, payload, "session"),

  "session.stopVoiceSession": ({
    payload,
  }: {
    payload: { sessionId: string };
  }) => wrapAuthorizedHandler(sessionStopVoiceSession, ctx, payload, "session"),

  "session.handleVoiceTranscript": ({
    payload,
  }: {
    payload: { sessionId: string; transcript: string };
  }) => wrapAuthorizedHandler(sessionHandleVoiceTranscript, ctx, payload, "session"),
});
