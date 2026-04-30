// PlanningRpc — wire contract for Bob planning operations.
// 7B-4C Task 4: 21 core planning + agent procedures.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { BobNotFoundError, BobForbiddenError } from "../errors.js";
import {
  PlanningStatusEnum,
  PlanningPriorityEnum,
  PlanningKindEnum,
  CycleStatusEnum,
  PlanningWorkspaceRecordSchema,
  PlanningProjectListItemSchema,
  PlanningProjectDetailSchema,
  PlanningTaskRecordSchema,
  PlanningTaskByIdentifierResultSchema,
  PlanningTaskMutationResultSchema,
  PlanningCommentRecordSchema,
  PlanningCommentCreateResultSchema,
  PlanningSearchResultSchema,
  PlanningLabelRecordSchema,
  PlanningCycleRecordSchema,
  PlanningUserRecordSchema,
  AgentClaimResultSchema,
  AgentProgressResultSchema,
  AgentCompleteResultSchema,
  AgentFailResultSchema,
  AgentArtifactSchema,
  AgentAvailableTaskSchema,
  AgentSessionResultSchema,
  AgentEndSessionResultSchema,
} from "../schemas/planning-core.js";

// --- Core planning procedures ---

export const PlanningListWorkspacesRpc = Rpc.make("planning.listWorkspaces", {
  payload: Schema.Void,
  success: Schema.Array(PlanningWorkspaceRecordSchema),
  error: BobNotFoundError,
});

export const PlanningListProjectsRpc = Rpc.make("planning.listProjects", {
  payload: Schema.Struct({ workspaceId: Schema.String }),
  success: Schema.Array(PlanningProjectListItemSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningGetProjectRpc = Rpc.make("planning.getProject", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(PlanningProjectDetailSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningListTasksRpc = Rpc.make("planning.listTasks", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    projectId: Schema.optional(Schema.String),
    status: Schema.optional(PlanningStatusEnum),
    priority: Schema.optional(PlanningPriorityEnum),
    assigneeId: Schema.optional(Schema.String),
    search: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(PlanningTaskRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningGetTaskRpc = Rpc.make("planning.getTask", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.NullOr(PlanningTaskRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningGetTaskByIdentifierRpc = Rpc.make(
  "planning.getTaskByIdentifier",
  {
    payload: Schema.Struct({
      identifier: Schema.String,
      workspaceId: Schema.optional(Schema.String),
    }),
    success: Schema.NullOr(PlanningTaskByIdentifierResultSchema),
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningCreateTaskRpc = Rpc.make("planning.createTask", {
  payload: Schema.Struct({
    projectId: Schema.String,
    title: Schema.String,
    description: Schema.optional(Schema.String),
    kind: Schema.optional(PlanningKindEnum),
    status: Schema.optional(PlanningStatusEnum),
    priority: Schema.optional(PlanningPriorityEnum),
    assigneeId: Schema.optional(Schema.String),
    labelIds: Schema.optional(Schema.Array(Schema.String)),
    dueDate: Schema.optional(Schema.String),
  }),
  success: PlanningTaskMutationResultSchema,
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningUpdateTaskRpc = Rpc.make("planning.updateTask", {
  payload: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    status: Schema.optional(PlanningStatusEnum),
    priority: Schema.optional(PlanningPriorityEnum),
    assigneeId: Schema.optional(Schema.NullOr(Schema.String)),
    dueDate: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: PlanningTaskMutationResultSchema,
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningAddCommentRpc = Rpc.make("planning.addComment", {
  payload: Schema.Struct({
    issueId: Schema.String,
    body: Schema.String,
  }),
  success: PlanningCommentCreateResultSchema,
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningListCommentsRpc = Rpc.make("planning.listComments", {
  payload: Schema.Struct({
    issueId: Schema.String,
    includeReplies: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Array(PlanningCommentRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningSearchTasksRpc = Rpc.make("planning.searchTasks", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    query: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(PlanningSearchResultSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningListLabelsRpc = Rpc.make("planning.listLabels", {
  payload: Schema.Struct({ workspaceId: Schema.String }),
  success: Schema.Array(PlanningLabelRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningListCyclesRpc = Rpc.make("planning.listCycles", {
  payload: Schema.Struct({
    workspaceId: Schema.String,
    status: Schema.optional(CycleStatusEnum),
  }),
  success: Schema.Array(PlanningCycleRecordSchema),
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningGetCurrentUserRpc = Rpc.make("planning.getCurrentUser", {
  payload: Schema.Void,
  success: PlanningUserRecordSchema,
  error: BobNotFoundError,
});

// --- Agent procedures ---

export const PlanningAgentClaimTaskRpc = Rpc.make("planning.agentClaimTask", {
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.String,
    sessionId: Schema.optional(Schema.String),
  }),
  success: AgentClaimResultSchema,
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningAgentReportProgressRpc = Rpc.make(
  "planning.agentReportProgress",
  {
    payload: Schema.Struct({
      taskRunId: Schema.String,
      progress: Schema.String,
    }),
    success: AgentProgressResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningAgentCompleteTaskRpc = Rpc.make(
  "planning.agentCompleteTask",
  {
    payload: Schema.Struct({
      taskRunId: Schema.String,
      summary: Schema.optional(Schema.String),
      artifacts: Schema.optional(Schema.Array(AgentArtifactSchema)),
      markIssueDone: Schema.optional(Schema.Boolean),
    }),
    success: AgentCompleteResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningAgentFailTaskRpc = Rpc.make("planning.agentFailTask", {
  payload: Schema.Struct({
    taskRunId: Schema.String,
    errorCode: Schema.String,
    errorMessage: Schema.String,
    recoverable: Schema.optional(Schema.Boolean),
    returnToBacklog: Schema.optional(Schema.Boolean),
  }),
  success: AgentFailResultSchema,
  error: BobNotFoundError,
});

export const PlanningAgentGetAvailableTasksRpc = Rpc.make(
  "planning.agentGetAvailableTasks",
  {
    payload: Schema.Struct({
      agentId: Schema.String,
      workspaceId: Schema.String,
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(AgentAvailableTaskSchema),
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningAgentStartSessionRpc = Rpc.make(
  "planning.agentStartSession",
  {
    payload: Schema.Struct({
      agentId: Schema.String,
      workspaceId: Schema.String,
      clientInfo: Schema.optional(Schema.String),
    }),
    success: AgentSessionResultSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningAgentEndSessionRpc = Rpc.make(
  "planning.agentEndSession",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: AgentEndSessionResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningRpc = RpcGroup.make(
  // Core planning (Task 4)
  PlanningListWorkspacesRpc,
  PlanningListProjectsRpc,
  PlanningGetProjectRpc,
  PlanningListTasksRpc,
  PlanningGetTaskRpc,
  PlanningGetTaskByIdentifierRpc,
  PlanningCreateTaskRpc,
  PlanningUpdateTaskRpc,
  PlanningAddCommentRpc,
  PlanningListCommentsRpc,
  PlanningSearchTasksRpc,
  PlanningListLabelsRpc,
  PlanningListCyclesRpc,
  PlanningGetCurrentUserRpc,
  // Agent procedures (Task 4)
  PlanningAgentClaimTaskRpc,
  PlanningAgentReportProgressRpc,
  PlanningAgentCompleteTaskRpc,
  PlanningAgentFailTaskRpc,
  PlanningAgentGetAvailableTasksRpc,
  PlanningAgentStartSessionRpc,
  PlanningAgentEndSessionRpc,
);
