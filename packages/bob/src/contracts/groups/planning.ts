// PlanningRpc — wire contract for Bob planning operations.
// 7B-4C Task 4: 21 core planning + agent procedures.
// 7B-4C Task 5: +15 planning.session.* procedures (36 total).
// 7B-4C Task 6: +11 planning.task.* + 8 planning.dispatch.* (55 total).
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
import {
  PlanningSessionTypeEnum,
  PlanSessionRecordSchema,
  PlanDraftRecordSchema,
  PlanDraftDependencySchema,
  PlanArtifactResultSchema,
  PriorContextResultSchema,
  CommitPlanResultSchema,
  CommitPlanLocalResultSchema,
  LaunchContextSchema,
  SessionStartResultSchema,
  SessionGetResultSchema,
  OkResultSchema,
} from "../schemas/planning-session.js";
import {
  PlanStatusEnum,
  PlanTaskStatusEnum,
  PlanTaskPriorityEnum,
  WorktreePlanRecordSchema,
  PlanTaskItemRecordSchema,
  DispatchBatchRecordSchema,
  DispatchItemRecordSchema,
  DispatchBatchWithItemsSchema,
  DispatchStartedResultSchema,
  SuccessResultSchema,
} from "../schemas/planning-ops.js";

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

// --- Planning session procedures (Task 5) ---

export const PlanningSessionCreateRpc = Rpc.make("planning.session.create", {
  payload: Schema.Struct({
    workspaceId: Schema.optional(Schema.String),
    projectId: Schema.optional(Schema.String),
    workingDirectory: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
    workItemId: Schema.optional(Schema.String),
    planningSessionType: Schema.optional(PlanningSessionTypeEnum),
  }),
  success: PlanSessionRecordSchema,
  error: Schema.Union([BobNotFoundError, BobForbiddenError]),
});

export const PlanningSessionStartRpc = Rpc.make("planning.session.start", {
  payload: Schema.Struct({
    sessionId: Schema.String,
    workspaceId: Schema.String,
    projectId: Schema.String,
    projectName: Schema.String,
    workingDirectory: Schema.String,
    launchContext: Schema.optional(LaunchContextSchema),
  }),
  success: SessionStartResultSchema,
  error: BobNotFoundError,
});

export const PlanningSessionGetRpc = Rpc.make("planning.session.get", {
  payload: Schema.Struct({ sessionId: Schema.String }),
  success: SessionGetResultSchema,
  error: BobNotFoundError,
});

export const PlanningSessionListRpc = Rpc.make("planning.session.list", {
  payload: Schema.Struct({
    workspaceId: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(PlanSessionRecordSchema),
  error: BobNotFoundError,
});

export const PlanningSessionListByWorkItemRpc = Rpc.make(
  "planning.session.listByWorkItem",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(PlanSessionRecordSchema),
    error: BobNotFoundError,
  },
);

export const PlanningSessionGetActiveForWorkItemRpc = Rpc.make(
  "planning.session.getActiveForWorkItem",
  {
    payload: Schema.Struct({ workItemId: Schema.String }),
    success: Schema.NullOr(PlanSessionRecordSchema),
    error: BobNotFoundError,
  },
);

export const PlanningSessionSaveArtifactRpc = Rpc.make(
  "planning.session.saveArtifact",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      workItemId: Schema.String,
      title: Schema.String,
      content: Schema.String,
      planningSessionType: Schema.optional(PlanningSessionTypeEnum),
    }),
    success: PlanArtifactResultSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningSessionGetPriorContextRpc = Rpc.make(
  "planning.session.getPriorContext",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      excludeSessionId: Schema.optional(Schema.String),
      maxChars: Schema.optional(Schema.Number),
    }),
    success: PriorContextResultSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningSessionCreateDraftRpc = Rpc.make(
  "planning.session.createDraft",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      workspaceId: Schema.String,
      projectId: Schema.String,
      title: Schema.String,
      description: Schema.optional(Schema.String),
      kind: Schema.optional(PlanningKindEnum),
      priority: Schema.optional(PlanningPriorityEnum),
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: PlanDraftRecordSchema,
    error: BobNotFoundError,
  },
);

export const PlanningSessionUpdateDraftRpc = Rpc.make(
  "planning.session.updateDraft",
  {
    payload: Schema.Struct({
      id: Schema.String,
      title: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
      kind: Schema.optional(PlanningKindEnum),
      priority: Schema.optional(PlanningPriorityEnum),
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: PlanDraftRecordSchema,
    error: BobNotFoundError,
  },
);

export const PlanningSessionRemoveDraftRpc = Rpc.make(
  "planning.session.removeDraft",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: OkResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningSessionSetDependencyRpc = Rpc.make(
  "planning.session.setDependency",
  {
    payload: Schema.Struct({
      draftId: Schema.String,
      dependsOnDraftId: Schema.String,
    }),
    success: PlanDraftDependencySchema,
    error: BobNotFoundError,
  },
);

export const PlanningSessionRemoveDependencyRpc = Rpc.make(
  "planning.session.removeDependency",
  {
    payload: Schema.Struct({
      draftId: Schema.String,
      dependsOnDraftId: Schema.String,
    }),
    success: OkResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningSessionCommitPlanRpc = Rpc.make(
  "planning.session.commitPlan",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: CommitPlanResultSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningSessionCommitPlanLocalRpc = Rpc.make(
  "planning.session.commitPlanLocal",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      parentWorkItemId: Schema.String,
    }),
    success: CommitPlanLocalResultSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

// --- Worktree plan + task item procedures (Task 6: planning.task.*) ---

export const PlanningTaskListRpc = Rpc.make("planning.task.list", {
  payload: Schema.Struct({
    worktreeId: Schema.optional(Schema.String),
  }),
  success: Schema.Array(WorktreePlanRecordSchema),
  error: BobNotFoundError,
});

export const PlanningTaskByIdRpc = Rpc.make("planning.task.byId", {
  payload: Schema.Struct({ id: Schema.String }),
  success: WorktreePlanRecordSchema,
  error: BobNotFoundError,
});

export const PlanningTaskByWorktreeRpc = Rpc.make(
  "planning.task.byWorktree",
  {
    payload: Schema.Struct({ worktreeId: Schema.String }),
    success: Schema.NullOr(WorktreePlanRecordSchema),
    error: BobNotFoundError,
  },
);

export const PlanningTaskCreateRpc = Rpc.make("planning.task.create", {
  payload: Schema.Struct({
    worktreeId: Schema.String,
    filePath: Schema.String,
    title: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    status: Schema.optional(PlanStatusEnum),
    planningTaskId: Schema.optional(Schema.String),
  }),
  success: WorktreePlanRecordSchema,
  error: BobNotFoundError,
});

export const PlanningTaskUpdateRpc = Rpc.make("planning.task.update", {
  payload: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    goal: Schema.optional(Schema.String),
    status: Schema.optional(PlanStatusEnum),
    planningTaskId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
  success: WorktreePlanRecordSchema,
  error: BobNotFoundError,
});

export const PlanningTaskDeleteRpc = Rpc.make("planning.task.delete", {
  payload: Schema.Struct({ id: Schema.String }),
  success: SuccessResultSchema,
  error: BobNotFoundError,
});

export const PlanningTaskSyncFromFileRpc = Rpc.make(
  "planning.task.syncFromFile",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: SuccessResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningTaskAddTaskRpc = Rpc.make("planning.task.addTask", {
  payload: Schema.Struct({
    planId: Schema.String,
    taskKey: Schema.String,
    content: Schema.String,
    status: Schema.optional(PlanTaskStatusEnum),
    priority: Schema.optional(PlanTaskPriorityEnum),
    parentTaskKey: Schema.optional(Schema.String),
    sortOrder: Schema.optional(Schema.Number),
  }),
  success: PlanTaskItemRecordSchema,
  error: BobNotFoundError,
});

export const PlanningTaskUpdateTaskRpc = Rpc.make(
  "planning.task.updateTask",
  {
    payload: Schema.Struct({
      id: Schema.String,
      content: Schema.optional(Schema.String),
      status: Schema.optional(PlanTaskStatusEnum),
      priority: Schema.optional(PlanTaskPriorityEnum),
      sortOrder: Schema.optional(Schema.Number),
    }),
    success: PlanTaskItemRecordSchema,
    error: BobNotFoundError,
  },
);

export const PlanningTaskDeleteTaskRpc = Rpc.make(
  "planning.task.deleteTask",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: SuccessResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningTaskReorderTasksRpc = Rpc.make(
  "planning.task.reorderTasks",
  {
    payload: Schema.Struct({
      planId: Schema.String,
      taskIds: Schema.Array(Schema.String),
    }),
    success: SuccessResultSchema,
    error: BobNotFoundError,
  },
);

// --- Dispatch procedures (Task 6: planning.dispatch.*) ---

export const PlanningDispatchCreateBatchRpc = Rpc.make(
  "planning.dispatch.createBatch",
  {
    payload: Schema.Struct({
      sessionId: Schema.String,
      concurrency: Schema.optional(Schema.Number),
      tasks: Schema.Array(
        Schema.Struct({
          draftId: Schema.String,
          taskId: Schema.String,
          identifier: Schema.String,
        }),
      ),
    }),
    success: DispatchBatchWithItemsSchema,
    error: Schema.Union([BobNotFoundError, BobForbiddenError]),
  },
);

export const PlanningDispatchGetBatchRpc = Rpc.make(
  "planning.dispatch.getBatch",
  {
    payload: Schema.Struct({ batchId: Schema.String }),
    success: DispatchBatchWithItemsSchema,
    error: BobNotFoundError,
  },
);

export const PlanningDispatchUpdateItemAgentRpc = Rpc.make(
  "planning.dispatch.updateItemAgent",
  {
    payload: Schema.Struct({
      itemId: Schema.String,
      agentType: Schema.String,
    }),
    success: DispatchItemRecordSchema,
    error: BobNotFoundError,
  },
);

export const PlanningDispatchUpdateConcurrencyRpc = Rpc.make(
  "planning.dispatch.updateConcurrency",
  {
    payload: Schema.Struct({
      batchId: Schema.String,
      concurrency: Schema.Number,
    }),
    success: DispatchBatchRecordSchema,
    error: BobNotFoundError,
  },
);

export const PlanningDispatchDispatchRpc = Rpc.make(
  "planning.dispatch.dispatch",
  {
    payload: Schema.Struct({ batchId: Schema.String }),
    success: DispatchStartedResultSchema,
    error: BobNotFoundError,
  },
);

export const PlanningDispatchCheckProgressRpc = Rpc.make(
  "planning.dispatch.checkProgress",
  {
    payload: Schema.Struct({ batchId: Schema.String }),
    success: DispatchBatchWithItemsSchema,
    error: BobNotFoundError,
  },
);

export const PlanningDispatchListBatchesRpc = Rpc.make(
  "planning.dispatch.listBatches",
  {
    payload: Schema.Struct({
      status: Schema.optional(Schema.String),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(DispatchBatchRecordSchema),
    error: BobNotFoundError,
  },
);

export const PlanningDispatchResetPipelineStateRpc = Rpc.make(
  "planning.dispatch.resetPipelineState",
  {
    payload: Schema.Struct({ itemId: Schema.String }),
    success: OkResultSchema,
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
  // Planning session procedures (Task 5)
  PlanningSessionCreateRpc,
  PlanningSessionStartRpc,
  PlanningSessionGetRpc,
  PlanningSessionListRpc,
  PlanningSessionListByWorkItemRpc,
  PlanningSessionGetActiveForWorkItemRpc,
  PlanningSessionSaveArtifactRpc,
  PlanningSessionGetPriorContextRpc,
  PlanningSessionCreateDraftRpc,
  PlanningSessionUpdateDraftRpc,
  PlanningSessionRemoveDraftRpc,
  PlanningSessionSetDependencyRpc,
  PlanningSessionRemoveDependencyRpc,
  PlanningSessionCommitPlanRpc,
  PlanningSessionCommitPlanLocalRpc,
  // Worktree plan + task item procedures (Task 6)
  PlanningTaskListRpc,
  PlanningTaskByIdRpc,
  PlanningTaskByWorktreeRpc,
  PlanningTaskCreateRpc,
  PlanningTaskUpdateRpc,
  PlanningTaskDeleteRpc,
  PlanningTaskSyncFromFileRpc,
  PlanningTaskAddTaskRpc,
  PlanningTaskUpdateTaskRpc,
  PlanningTaskDeleteTaskRpc,
  PlanningTaskReorderTasksRpc,
  // Dispatch procedures (Task 6)
  PlanningDispatchCreateBatchRpc,
  PlanningDispatchGetBatchRpc,
  PlanningDispatchUpdateItemAgentRpc,
  PlanningDispatchUpdateConcurrencyRpc,
  PlanningDispatchDispatchRpc,
  PlanningDispatchCheckProgressRpc,
  PlanningDispatchListBatchesRpc,
  PlanningDispatchResetPipelineStateRpc,
);
