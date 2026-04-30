// Phase 6F Task 6 — AgentRpc contract group.
//
// Five procedures — one of which (`agent.sendTurn`) is the first streaming
// RPC in gmacko. The streaming declaration uses the `stream: true` flag on
// `Rpc.make`; per Effect 4.0.0-beta.43 (`effect/unstable/rpc/Rpc.d.ts:287`)
// the success schema is transparently wrapped in `RpcSchema.Stream<Success,
// Error>` and the top-level `error` channel becomes `Schema.Never`. Error
// shapes flow through the stream itself.
//
// Tagged error classes come straight from `@gmacko/agent`:
//   - AgentSessionNotFoundError — the conversation doesn't exist in this tenant.
//   - TurnInProgressError       — another turn is already running for this conversation.
//   - AdapterSpawnError         — failed to start the adapter subprocess.
//   - AdapterExitError          — adapter subprocess exited abnormally.
// All four are `Schema.TaggedErrorClass` subclasses and hence Schema instances,
// so they drop into `Schema.Union([...])` for the stream's error channel.
//
// Drift finding: `Schema.Union` takes an array literal (NOT a variadic
// argument list), per Schema.d.ts:2626. Tagged errors with differing payload
// shapes typecheck fine inside the union at the error slot.

import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  AdapterExitError,
  AdapterSpawnError,
  AgentSessionNotFoundError,
  TurnInProgressError,
} from "@gmacko/core/agent/errors";

import {
  AgentEventSchema,
  ChatConversationSchema,
  ChatMessageSchema,
} from "../schemas/agent.js";
import { AgentRunSchema } from "../schemas/agent-run.js";
import {
  CaptureTargetSchema,
  CaptureResultSchema,
} from "../schemas/agent-capture.js";
import {
  SessionSchema,
  SessionEventSchema,
  SessionConnectionSchema,
  SessionStatusEnum,
  EventDirectionEnum,
  WorkflowStatusEnum,
  WorkflowStateSchema,
  ArtifactTypeEnum,
  ArtifactRoleEnum,
  SessionLeaseConflictError,
} from "../schemas/agent-session.js";
import { NotFoundError } from "../../rpc/errors.js";

/** Union of every error `agent.sendTurn` can surface (on its stream). */
export const AgentStreamErrorSchema = Schema.Union([
  AgentSessionNotFoundError,
  TurnInProgressError,
  AdapterSpawnError,
  AdapterExitError,
]);

// --- createSession ----------------------------------------------------------

export const AgentCreateSessionRpc = Rpc.make("agent.createSession", {
  payload: Schema.Struct({
    adapterId: Schema.String,
    title: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    cwd: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    conversationId: Schema.String,
    status: Schema.Literal("pending"),
  }),
});

// --- sendTurn (streaming) ---------------------------------------------------
//
// `stream: true` rewires the success/error channel semantics per
// `Rpc.d.ts:287-294`:
//   - success (declared)  → `RpcSchema.Stream<Success, Error>`
//   - error   (declared)  → `Schema.Never`
// Adapter errors flow *through* the stream, matching the `@gmacko/agent`
// convention where `AgentAdapter.sendTurn` returns `Stream<AgentEvent, AdapterError>`.

export const AgentSendTurnRpc = Rpc.make("agent.sendTurn", {
  stream: true,
  payload: Schema.Struct({
    conversationId: Schema.String,
    prompt: Schema.String,
  }),
  success: AgentEventSchema,
  error: AgentStreamErrorSchema,
});

// --- cancelSession ----------------------------------------------------------

export const AgentCancelSessionRpc = Rpc.make("agent.cancelSession", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

// --- closeSession -----------------------------------------------------------

export const AgentCloseSessionRpc = Rpc.make("agent.closeSession", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Void,
  error: AgentSessionNotFoundError,
});

// --- getTranscript ----------------------------------------------------------

export const AgentGetTranscriptRpc = Rpc.make("agent.getTranscript", {
  payload: Schema.Struct({ conversationId: Schema.String }),
  success: Schema.Struct({
    conversation: ChatConversationSchema,
    messages: Schema.Array(ChatMessageSchema),
  }),
  error: AgentSessionNotFoundError,
});

// --- agent.run.get -----------------------------------------------------------

export const AgentRunGetRpc = Rpc.make("agent.run.get", {
  payload: Schema.Struct({
    runId: Schema.String, // UUID
  }),
  success: AgentRunSchema,
  error: NotFoundError,
});

// --- agent.run.list ----------------------------------------------------------

export const AgentRunListRpc = Rpc.make("agent.run.list", {
  payload: Schema.Struct({
    workspaceId: Schema.String, // UUID
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(AgentRunSchema),
});

// --- agent.run.listByWorkItem ------------------------------------------------

export const AgentRunListByWorkItemRpc = Rpc.make("agent.run.listByWorkItem", {
  payload: Schema.Struct({
    workItemId: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(AgentRunSchema),
  error: NotFoundError,
});

// --- agent.capture.listTargets -----------------------------------------------

export const AgentCaptureListTargetsRpc = Rpc.make(
  "agent.capture.listTargets",
  {
    payload: Schema.Void,
    success: Schema.Array(CaptureTargetSchema),
  },
);

// --- agent.capture.capture ---------------------------------------------------

export const AgentCaptureCaptureRpc = Rpc.make("agent.capture.capture", {
  payload: Schema.Struct({
    targetType: Schema.Literal("browser", "window", "screen"),
    targetId: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
  }),
  success: CaptureResultSchema,
});

// ---------------------------------------------------------------------------
// agent.session.* — 28 RPCs (7B-4B Task 2)
// ---------------------------------------------------------------------------

// --- agent.session.list -----------------------------------------------------

export const AgentSessionListRpc = Rpc.make("agent.session.list", {
  payload: Schema.Struct({
    repositoryId: Schema.optional(Schema.String),
    worktreeId: Schema.optional(Schema.String),
    status: Schema.optional(SessionStatusEnum),
    limit: Schema.optional(Schema.Number),
    cursor: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({
    items: Schema.Array(SessionSchema),
    nextCursor: Schema.optional(Schema.String),
  }),
});

// --- agent.session.get ------------------------------------------------------

export const AgentSessionGetRpc = Rpc.make("agent.session.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: SessionSchema,
  error: NotFoundError,
});

// --- agent.session.create ---------------------------------------------------

export const AgentSessionCreateRpc = Rpc.make("agent.session.create", {
  payload: Schema.Struct({
    repositoryId: Schema.optional(Schema.String),
    worktreeId: Schema.optional(Schema.String),
    workingDirectory: Schema.String,
    agentType: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
  }),
  success: SessionSchema,
});

// --- agent.session.bootstrapForChat -----------------------------------------

export const AgentSessionBootstrapForChatRpc = Rpc.make(
  "agent.session.bootstrapForChat",
  {
    payload: Schema.Struct({
      repositoryId: Schema.optional(Schema.String),
      worktreeId: Schema.optional(Schema.String),
      workingDirectory: Schema.String,
      agentType: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({
      session: SessionSchema,
      gateway: Schema.Struct({
        url: Schema.String,
        shouldStartOnConnect: Schema.Boolean,
      }),
    }),
  },
);

// --- agent.session.updateTitle ----------------------------------------------

export const AgentSessionUpdateTitleRpc = Rpc.make(
  "agent.session.updateTitle",
  {
    payload: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
    }),
    success: SessionSchema,
    error: NotFoundError,
  },
);

// --- agent.session.stop -----------------------------------------------------

export const AgentSessionStopRpc = Rpc.make("agent.session.stop", {
  payload: Schema.Struct({ id: Schema.String }),
  success: SessionSchema,
  error: NotFoundError,
});

// --- agent.session.delete ---------------------------------------------------

export const AgentSessionDeleteRpc = Rpc.make("agent.session.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.session.getEvents ------------------------------------------------

export const AgentSessionGetEventsRpc = Rpc.make("agent.session.getEvents", {
  payload: Schema.Struct({
    sessionId: Schema.String,
    fromSeq: Schema.optional(Schema.Number),
    toSeq: Schema.optional(Schema.Number),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Struct({
    events: Schema.Array(SessionEventSchema),
    latestSeq: Schema.Number,
  }),
  error: NotFoundError,
});

// --- agent.session.getConnections -------------------------------------------

export const AgentSessionGetConnectionsRpc = Rpc.make(
  "agent.session.getConnections",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: Schema.Array(SessionConnectionSchema),
    error: NotFoundError,
  },
);

// --- agent.session.sendHeadlessInput ----------------------------------------

export const AgentSessionSendHeadlessInputRpc = Rpc.make(
  "agent.session.sendHeadlessInput",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      message: Schema.String,
    }),
    success: Schema.Struct({
      sessionId: Schema.String,
      seq: Schema.Struct({
        input: Schema.Number,
        assistant: Schema.Number,
      }),
    }),
    error: NotFoundError,
  },
);

// --- agent.session.updateStatus ---------------------------------------------

export const AgentSessionUpdateStatusRpc = Rpc.make(
  "agent.session.updateStatus",
  {
    payload: Schema.Struct({
      id: Schema.String,
      status: SessionStatusEnum,
      lastError: Schema.optional(
        Schema.Struct({
          code: Schema.String,
          message: Schema.String,
          timestamp: Schema.String,
        }),
      ),
    }),
    success: SessionSchema,
    error: NotFoundError,
  },
);

// --- agent.session.claimLease -----------------------------------------------

export const AgentSessionClaimLeaseRpc = Rpc.make(
  "agent.session.claimLease",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      gatewayId: Schema.String,
      leaseMs: Schema.optional(Schema.Number),
    }),
    success: SessionSchema,
    error: Schema.Union([NotFoundError, SessionLeaseConflictError]),
  },
);

// --- agent.session.releaseLease ---------------------------------------------

export const AgentSessionReleaseLeaseRpc = Rpc.make(
  "agent.session.releaseLease",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: SessionSchema,
    error: NotFoundError,
  },
);

// --- agent.session.recordEvent ----------------------------------------------

export const AgentSessionRecordEventRpc = Rpc.make(
  "agent.session.recordEvent",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      seq: Schema.Number,
      direction: EventDirectionEnum,
      eventType: Schema.String,
      payload: Schema.Record(Schema.String, Schema.Unknown),
    }),
    success: SessionEventSchema,
    error: NotFoundError,
  },
);

// --- agent.session.recordEventBatch -----------------------------------------

export const AgentSessionRecordEventBatchRpc = Rpc.make(
  "agent.session.recordEventBatch",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      events: Schema.Array(
        Schema.Struct({
          seq: Schema.Number,
          direction: EventDirectionEnum,
          eventType: Schema.String,
          payload: Schema.Record(Schema.String, Schema.Unknown),
        }),
      ),
    }),
    success: Schema.Struct({ count: Schema.Number }),
    error: NotFoundError,
  },
);

// --- agent.session.getGatewayWebSocketUrl -----------------------------------

export const AgentSessionGetGatewayWebSocketUrlRpc = Rpc.make(
  "agent.session.getGatewayWebSocketUrl",
  {
    payload: Schema.Void,
    success: Schema.Struct({
      url: Schema.String,
      userId: Schema.String,
    }),
  },
);

// --- agent.session.reportWorkflowStatus -------------------------------------

export const AgentSessionReportWorkflowStatusRpc = Rpc.make(
  "agent.session.reportWorkflowStatus",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      status: WorkflowStatusEnum,
      message: Schema.String,
      details: Schema.optional(
        Schema.Struct({
          phase: Schema.optional(Schema.String),
          progress: Schema.optional(Schema.String),
        }),
      ),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.reportTaskProgress ---------------------------------------

export const AgentSessionReportTaskProgressRpc = Rpc.make(
  "agent.session.reportTaskProgress",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      message: Schema.String,
      phase: Schema.optional(Schema.String),
      progress: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.linkTaskArtifact -----------------------------------------

export const AgentSessionLinkTaskArtifactRpc = Rpc.make(
  "agent.session.linkTaskArtifact",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      artifactType: ArtifactTypeEnum,
      artifactRole: Schema.optional(ArtifactRoleEnum),
      url: Schema.String,
      title: Schema.optional(Schema.String),
      summary: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.markTaskReviewReady --------------------------------------

export const AgentSessionMarkTaskReviewReadyRpc = Rpc.make(
  "agent.session.markTaskReviewReady",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      prUrl: Schema.String,
      summary: Schema.String,
      notesForReviewer: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.recordVerificationResult ---------------------------------

export const AgentSessionRecordVerificationResultRpc = Rpc.make(
  "agent.session.recordVerificationResult",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      result: Schema.Literal("passed", "failed"),
      summary: Schema.String,
      artifactUrl: Schema.optional(Schema.String),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.completeTask ---------------------------------------------

export const AgentSessionCompleteTaskRpc = Rpc.make(
  "agent.session.completeTask",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      summary: Schema.String,
      prUrl: Schema.optional(Schema.String),
      markIssueDone: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.requestInput ---------------------------------------------

export const AgentSessionRequestInputRpc = Rpc.make(
  "agent.session.requestInput",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      question: Schema.String,
      options: Schema.optional(Schema.Array(Schema.String)),
      defaultAction: Schema.String,
      timeoutMinutes: Schema.optional(Schema.Number),
    }),
    success: Schema.Struct({
      promptId: Schema.String,
      status: Schema.String,
    }),
  },
);

// --- agent.session.resolveAwaitingInput -------------------------------------

export const AgentSessionResolveAwaitingInputRpc = Rpc.make(
  "agent.session.resolveAwaitingInput",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      resolution: Schema.Struct({
        type: Schema.Literal("human", "timeout"),
        value: Schema.String,
      }),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.session.getWorkflowState -----------------------------------------

export const AgentSessionGetWorkflowStateRpc = Rpc.make(
  "agent.session.getWorkflowState",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: WorkflowStateSchema,
    error: NotFoundError,
  },
);

// --- agent.session.createVoiceSession ---------------------------------------

export const AgentSessionCreateVoiceSessionRpc = Rpc.make(
  "agent.session.createVoiceSession",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: Schema.Struct({
      voiceSessionId: Schema.String,
      url: Schema.String,
    }),
    error: NotFoundError,
  },
);

// --- agent.session.stopVoiceSession -----------------------------------------

export const AgentSessionStopVoiceSessionRpc = Rpc.make(
  "agent.session.stopVoiceSession",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: Schema.Struct({ success: Schema.Boolean }),
    error: NotFoundError,
  },
);

// --- agent.session.handleVoiceTranscript ------------------------------------

export const AgentSessionHandleVoiceTranscriptRpc = Rpc.make(
  "agent.session.handleVoiceTranscript",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      transcript: Schema.String,
    }),
    success: Schema.Struct({ assistantText: Schema.String }),
    error: NotFoundError,
  },
);

// --- Group ------------------------------------------------------------------

export const AgentRpc = RpcGroup.make(
  // Original 5
  AgentCreateSessionRpc,
  AgentSendTurnRpc,
  AgentCancelSessionRpc,
  AgentCloseSessionRpc,
  AgentGetTranscriptRpc,
  // agent.run (3) — Task 1
  AgentRunGetRpc,
  AgentRunListRpc,
  AgentRunListByWorkItemRpc,
  // agent.capture (2) — Task 1
  AgentCaptureListTargetsRpc,
  AgentCaptureCaptureRpc,
  // agent.session (28) — Task 2
  AgentSessionListRpc,
  AgentSessionGetRpc,
  AgentSessionCreateRpc,
  AgentSessionBootstrapForChatRpc,
  AgentSessionUpdateTitleRpc,
  AgentSessionStopRpc,
  AgentSessionDeleteRpc,
  AgentSessionGetEventsRpc,
  AgentSessionGetConnectionsRpc,
  AgentSessionSendHeadlessInputRpc,
  AgentSessionUpdateStatusRpc,
  AgentSessionClaimLeaseRpc,
  AgentSessionReleaseLeaseRpc,
  AgentSessionRecordEventRpc,
  AgentSessionRecordEventBatchRpc,
  AgentSessionGetGatewayWebSocketUrlRpc,
  AgentSessionReportWorkflowStatusRpc,
  AgentSessionReportTaskProgressRpc,
  AgentSessionLinkTaskArtifactRpc,
  AgentSessionMarkTaskReviewReadyRpc,
  AgentSessionRecordVerificationResultRpc,
  AgentSessionCompleteTaskRpc,
  AgentSessionRequestInputRpc,
  AgentSessionResolveAwaitingInputRpc,
  AgentSessionGetWorkflowStateRpc,
  AgentSessionCreateVoiceSessionRpc,
  AgentSessionStopVoiceSessionRpc,
  AgentSessionHandleVoiceTranscriptRpc,
);
