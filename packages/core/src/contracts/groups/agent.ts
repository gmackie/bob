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
import {
  AgentInstanceSchema,
  InstanceStatusEnum,
  AgentTypeEnum,
} from "../schemas/agent-instance.js";
import {
  AgentTerminalSessionSchema,
  DirectoryTerminalSessionSchema,
  SystemTerminalSessionSchema,
} from "../schemas/agent-terminal.js";
import {
  EventLogSchema,
  EventTypeEnum,
  EventStatsSchema,
} from "../schemas/agent-event.js";
import {
  FileEntrySchema,
  GitStatusEntrySchema,
  FileSearchResultSchema,
} from "../schemas/agent-filesystem.js";
import { ChatAttachmentSchema } from "../schemas/agent-chat.js";
import { PostSchema } from "../schemas/agent-post.js";
import {
  AgentPersonaSchema,
  PersonaSourceEnum,
  PersonaNotFoundError,
  PersonaReadOnlyError,
  PersonaSyncResultSchema,
} from "../schemas/agent-persona.js";
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
    targetType: Schema.Literals(["browser", "window", "screen"]),
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
    personaId: Schema.optional(Schema.String),
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
      personaId: Schema.optional(Schema.String),
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
      result: Schema.Literals(["passed", "failed"]),
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
        type: Schema.Literals(["human", "timeout"]),
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

// ---------------------------------------------------------------------------
// agent.instance.* — 9 RPCs (7B-4B Task 3)
// ---------------------------------------------------------------------------

// --- agent.instance.list ---------------------------------------------------

export const AgentInstanceListRpc = Rpc.make("agent.instance.list", {
  payload: Schema.Void,
  success: Schema.Array(AgentInstanceSchema),
});

// --- agent.instance.byId ---------------------------------------------------

export const AgentInstanceByIdRpc = Rpc.make("agent.instance.byId", {
  payload: Schema.Struct({ id: Schema.String }),
  success: AgentInstanceSchema,
  error: NotFoundError,
});

// --- agent.instance.byRepository -------------------------------------------

export const AgentInstanceByRepositoryRpc = Rpc.make(
  "agent.instance.byRepository",
  {
    payload: Schema.Struct({ repositoryId: Schema.String }),
    success: Schema.Array(AgentInstanceSchema),
  },
);

// --- agent.instance.byWorktree ---------------------------------------------

export const AgentInstanceByWorktreeRpc = Rpc.make(
  "agent.instance.byWorktree",
  {
    payload: Schema.Struct({ worktreeId: Schema.String }),
    success: Schema.Array(AgentInstanceSchema),
  },
);

// --- agent.instance.start --------------------------------------------------

export const AgentInstanceStartRpc = Rpc.make("agent.instance.start", {
  payload: Schema.Struct({
    worktreeId: Schema.String,
    agentType: Schema.optional(AgentTypeEnum),
  }),
  success: AgentInstanceSchema,
  error: NotFoundError,
});

// --- agent.instance.stop ---------------------------------------------------

export const AgentInstanceStopRpc = Rpc.make("agent.instance.stop", {
  payload: Schema.Struct({ id: Schema.String }),
  success: AgentInstanceSchema,
  error: NotFoundError,
});

// --- agent.instance.restart ------------------------------------------------

export const AgentInstanceRestartRpc = Rpc.make("agent.instance.restart", {
  payload: Schema.Struct({ id: Schema.String }),
  success: AgentInstanceSchema,
  error: NotFoundError,
});

// --- agent.instance.delete -------------------------------------------------

export const AgentInstanceDeleteRpc = Rpc.make("agent.instance.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.instance.updateStatus -------------------------------------------

export const AgentInstanceUpdateStatusRpc = Rpc.make(
  "agent.instance.updateStatus",
  {
    payload: Schema.Struct({
      id: Schema.String,
      status: InstanceStatusEnum,
      pid: Schema.optional(Schema.Number),
      errorMessage: Schema.optional(Schema.String),
    }),
    success: AgentInstanceSchema,
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// agent.terminal.* — 5 RPCs (7B-4B Task 3)
// ---------------------------------------------------------------------------

// --- agent.terminal.createAgentSession -------------------------------------

export const AgentTerminalCreateAgentSessionRpc = Rpc.make(
  "agent.terminal.createAgentSession",
  {
    payload: Schema.Struct({ instanceId: Schema.String }),
    success: AgentTerminalSessionSchema,
    error: NotFoundError,
  },
);

// --- agent.terminal.createDirectorySession ---------------------------------

export const AgentTerminalCreateDirectorySessionRpc = Rpc.make(
  "agent.terminal.createDirectorySession",
  {
    payload: Schema.Struct({ instanceId: Schema.String }),
    success: DirectoryTerminalSessionSchema,
    error: NotFoundError,
  },
);

// --- agent.terminal.createSystemSession ------------------------------------

export const AgentTerminalCreateSystemSessionRpc = Rpc.make(
  "agent.terminal.createSystemSession",
  {
    payload: Schema.Struct({
      cwd: Schema.optional(Schema.String),
      initialCommand: Schema.optional(Schema.String),
    }),
    success: SystemTerminalSessionSchema,
  },
);

// --- agent.terminal.listByInstance ------------------------------------------

export const AgentTerminalListByInstanceRpc = Rpc.make(
  "agent.terminal.listByInstance",
  {
    payload: Schema.Struct({ instanceId: Schema.String }),
    success: Schema.Array(AgentTerminalSessionSchema),
    error: NotFoundError,
  },
);

// --- agent.terminal.close --------------------------------------------------

export const AgentTerminalCloseRpc = Rpc.make("agent.terminal.close", {
  payload: Schema.Struct({ sessionId: Schema.String }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// ---------------------------------------------------------------------------
// agent.event.* — 5 RPCs (7B-4B Task 3)
// ---------------------------------------------------------------------------

// --- agent.event.list ------------------------------------------------------

export const AgentEventListRpc = Rpc.make("agent.event.list", {
  payload: Schema.Struct({
    worktreeId: Schema.optional(Schema.String),
    repositoryId: Schema.optional(Schema.String),
    eventType: Schema.optional(EventTypeEnum),
    limit: Schema.optional(Schema.Number),
    offset: Schema.optional(Schema.Number),
    since: Schema.optional(Schema.String),
    until: Schema.optional(Schema.String),
  }),
  success: Schema.Array(EventLogSchema),
});

// --- agent.event.create ----------------------------------------------------

export const AgentEventCreateRpc = Rpc.make("agent.event.create", {
  payload: Schema.Struct({
    worktreeId: Schema.optional(Schema.String),
    repositoryId: Schema.optional(Schema.String),
    eventType: EventTypeEnum,
    payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: EventLogSchema,
});

// --- agent.event.recentActivity --------------------------------------------

export const AgentEventRecentActivityRpc = Rpc.make(
  "agent.event.recentActivity",
  {
    payload: Schema.Struct({
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(EventLogSchema),
  },
);

// --- agent.event.byWorktree ------------------------------------------------

export const AgentEventByWorktreeRpc = Rpc.make("agent.event.byWorktree", {
  payload: Schema.Struct({
    worktreeId: Schema.String,
    limit: Schema.optional(Schema.Number),
    since: Schema.optional(Schema.String),
  }),
  success: Schema.Array(EventLogSchema),
});

// --- agent.event.stats -----------------------------------------------------

export const AgentEventStatsRpc = Rpc.make("agent.event.stats", {
  payload: Schema.Struct({
    worktreeId: Schema.optional(Schema.String),
    repositoryId: Schema.optional(Schema.String),
    since: Schema.optional(Schema.String),
  }),
  success: EventStatsSchema,
});

// ---------------------------------------------------------------------------
// agent.filesystem.* — 9 RPCs (7B-4B Task 4)
// ---------------------------------------------------------------------------

// --- agent.filesystem.list -------------------------------------------------

export const AgentFilesystemListRpc = Rpc.make("agent.filesystem.list", {
  payload: Schema.Struct({
    path: Schema.String,
    showHidden: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Array(FileEntrySchema),
});

// --- agent.filesystem.read -------------------------------------------------

export const AgentFilesystemReadRpc = Rpc.make("agent.filesystem.read", {
  payload: Schema.Struct({
    path: Schema.String,
    encoding: Schema.optional(Schema.Literals(["utf-8", "base64"])),
  }),
  success: Schema.Struct({ content: Schema.String }),
});

// --- agent.filesystem.write ------------------------------------------------

export const AgentFilesystemWriteRpc = Rpc.make("agent.filesystem.write", {
  payload: Schema.Struct({
    path: Schema.String,
    content: Schema.String,
    createDirs: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.filesystem.delete -----------------------------------------------

export const AgentFilesystemDeleteRpc = Rpc.make("agent.filesystem.delete", {
  payload: Schema.Struct({
    path: Schema.String,
    recursive: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.filesystem.mkdir ------------------------------------------------

export const AgentFilesystemMkdirRpc = Rpc.make("agent.filesystem.mkdir", {
  payload: Schema.Struct({
    path: Schema.String,
    recursive: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.filesystem.move -------------------------------------------------

export const AgentFilesystemMoveRpc = Rpc.make("agent.filesystem.move", {
  payload: Schema.Struct({
    source: Schema.String,
    destination: Schema.String,
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.filesystem.copy -------------------------------------------------

export const AgentFilesystemCopyRpc = Rpc.make("agent.filesystem.copy", {
  payload: Schema.Struct({
    source: Schema.String,
    destination: Schema.String,
  }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.filesystem.search -----------------------------------------------

export const AgentFilesystemSearchRpc = Rpc.make("agent.filesystem.search", {
  payload: Schema.Struct({
    path: Schema.String,
    pattern: Schema.String,
    maxResults: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(FileSearchResultSchema),
});

// --- agent.filesystem.gitStatus --------------------------------------------

export const AgentFilesystemGitStatusRpc = Rpc.make(
  "agent.filesystem.gitStatus",
  {
    payload: Schema.Struct({ path: Schema.String }),
    success: Schema.Array(GitStatusEntrySchema),
  },
);

// ---------------------------------------------------------------------------
// agent.chat.* — 8 RPCs (7B-4B Task 4)
// ---------------------------------------------------------------------------

// --- agent.chat.listConversations ------------------------------------------

export const AgentChatListConversationsRpc = Rpc.make(
  "agent.chat.listConversations",
  {
    payload: Schema.Struct({
      repositoryId: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(ChatConversationSchema),
  },
);

// --- agent.chat.getConversation --------------------------------------------

export const AgentChatGetConversationRpc = Rpc.make(
  "agent.chat.getConversation",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({
      conversation: ChatConversationSchema,
      messages: Schema.Array(ChatMessageSchema),
    }),
    error: NotFoundError,
  },
);

// --- agent.chat.createConversation -----------------------------------------

export const AgentChatCreateConversationRpc = Rpc.make(
  "agent.chat.createConversation",
  {
    payload: Schema.Struct({
      repositoryId: Schema.optional(Schema.String),
      worktreeId: Schema.optional(Schema.String),
      workingDirectory: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      sessionType: Schema.optional(Schema.String),
      workItemId: Schema.optional(Schema.String),
    }),
    success: ChatConversationSchema,
  },
);

// --- agent.chat.deleteConversation -----------------------------------------

export const AgentChatDeleteConversationRpc = Rpc.make(
  "agent.chat.deleteConversation",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

// --- agent.chat.sendMessage ------------------------------------------------

export const AgentChatSendMessageRpc = Rpc.make("agent.chat.sendMessage", {
  payload: Schema.Struct({
    conversationId: Schema.String,
    content: Schema.String,
  }),
  success: ChatMessageSchema,
  error: NotFoundError,
});

// --- agent.chat.getMessages ------------------------------------------------

export const AgentChatGetMessagesRpc = Rpc.make("agent.chat.getMessages", {
  payload: Schema.Struct({
    conversationId: Schema.String,
    limit: Schema.optional(Schema.Number),
    before: Schema.optional(Schema.String),
  }),
  success: Schema.Array(ChatMessageSchema),
  error: NotFoundError,
});

// --- agent.chat.attachImage ------------------------------------------------

export const AgentChatAttachImageRpc = Rpc.make("agent.chat.attachImage", {
  payload: Schema.Struct({
    messageId: Schema.String,
    url: Schema.String,
    filename: Schema.optional(Schema.String),
    mimeType: Schema.optional(Schema.String),
    width: Schema.optional(Schema.Number),
    height: Schema.optional(Schema.Number),
    sizeBytes: Schema.optional(Schema.Number),
  }),
  success: ChatAttachmentSchema,
  error: NotFoundError,
});

// --- agent.chat.getAttachments ---------------------------------------------

export const AgentChatGetAttachmentsRpc = Rpc.make(
  "agent.chat.getAttachments",
  {
    payload: Schema.Struct({ messageId: Schema.String }),
    success: Schema.Array(ChatAttachmentSchema),
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// agent.post.* — 4 RPCs (7B-4B Task 4)
// ---------------------------------------------------------------------------

// --- agent.post.all --------------------------------------------------------

export const AgentPostAllRpc = Rpc.make("agent.post.all", {
  payload: Schema.Void,
  success: Schema.Array(PostSchema),
});

// --- agent.post.byId -------------------------------------------------------

export const AgentPostByIdRpc = Rpc.make("agent.post.byId", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(PostSchema),
});

// --- agent.post.create -----------------------------------------------------

export const AgentPostCreateRpc = Rpc.make("agent.post.create", {
  payload: Schema.Struct({
    title: Schema.String,
    content: Schema.String,
  }),
  success: PostSchema,
});

// --- agent.post.delete -----------------------------------------------------

export const AgentPostDeleteRpc = Rpc.make("agent.post.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ success: Schema.Boolean }),
});

// --- agent.persona (6) ------------------------------------------------------

export const AgentPersonaCreateRpc = Rpc.make("agent.persona.create", {
  payload: Schema.Struct({
    name: Schema.String,
    slug: Schema.String,
    description: Schema.optional(Schema.String),
    adapterId: Schema.String,
    model: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    autonomyLevel: Schema.optional(Schema.String),
    budgetLimitCents: Schema.optional(Schema.Number),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: AgentPersonaSchema,
});

export const AgentPersonaListRpc = Rpc.make("agent.persona.list", {
  payload: Schema.Struct({
    active: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Array(AgentPersonaSchema),
});

export const AgentPersonaGetRpc = Rpc.make("agent.persona.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: AgentPersonaSchema,
  error: PersonaNotFoundError,
});

export const AgentPersonaUpdateRpc = Rpc.make("agent.persona.update", {
  payload: Schema.Struct({
    id: Schema.String,
    name: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    adapterId: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    systemPrompt: Schema.optional(Schema.String),
    allowedTools: Schema.optional(Schema.Array(Schema.String)),
    autonomyLevel: Schema.optional(Schema.String),
    budgetLimitCents: Schema.optional(Schema.Number),
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: AgentPersonaSchema,
  error: Schema.Union([PersonaNotFoundError, PersonaReadOnlyError]),
});

export const AgentPersonaDeleteRpc = Rpc.make("agent.persona.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: Schema.Union([PersonaNotFoundError, PersonaReadOnlyError]),
});

export const AgentPersonaSyncRepoRpc = Rpc.make("agent.persona.syncRepo", {
  payload: Schema.Struct({}),
  success: PersonaSyncResultSchema,
});

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
  // agent.instance (9) — Task 3
  AgentInstanceListRpc,
  AgentInstanceByIdRpc,
  AgentInstanceByRepositoryRpc,
  AgentInstanceByWorktreeRpc,
  AgentInstanceStartRpc,
  AgentInstanceStopRpc,
  AgentInstanceRestartRpc,
  AgentInstanceDeleteRpc,
  AgentInstanceUpdateStatusRpc,
  // agent.terminal (5) — Task 3
  AgentTerminalCreateAgentSessionRpc,
  AgentTerminalCreateDirectorySessionRpc,
  AgentTerminalCreateSystemSessionRpc,
  AgentTerminalListByInstanceRpc,
  AgentTerminalCloseRpc,
  // agent.event (5) — Task 3
  AgentEventListRpc,
  AgentEventCreateRpc,
  AgentEventRecentActivityRpc,
  AgentEventByWorktreeRpc,
  AgentEventStatsRpc,
  // agent.filesystem (9) — Task 4
  AgentFilesystemListRpc,
  AgentFilesystemReadRpc,
  AgentFilesystemWriteRpc,
  AgentFilesystemDeleteRpc,
  AgentFilesystemMkdirRpc,
  AgentFilesystemMoveRpc,
  AgentFilesystemCopyRpc,
  AgentFilesystemSearchRpc,
  AgentFilesystemGitStatusRpc,
  // agent.chat (8) — Task 4
  AgentChatListConversationsRpc,
  AgentChatGetConversationRpc,
  AgentChatCreateConversationRpc,
  AgentChatDeleteConversationRpc,
  AgentChatSendMessageRpc,
  AgentChatGetMessagesRpc,
  AgentChatAttachImageRpc,
  AgentChatGetAttachmentsRpc,
  // agent.post (4) — Task 4
  AgentPostAllRpc,
  AgentPostByIdRpc,
  AgentPostCreateRpc,
  AgentPostDeleteRpc,
  // agent.persona (6)
  AgentPersonaCreateRpc,
  AgentPersonaListRpc,
  AgentPersonaGetRpc,
  AgentPersonaUpdateRpc,
  AgentPersonaDeleteRpc,
  AgentPersonaSyncRepoRpc,
);
