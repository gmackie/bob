export {
  BobNotFoundError,
  BobForbiddenError,
  BobConflictError,
} from "./errors.js";

export { mapTrpcError } from "./bridge.js";
export type { NotFoundContext, MessageContext, TrpcErrorCode } from "./bridge.js";

// --- RpcGroups ---

export { WorkItemsRpc } from "./groups/work-items.js";
export { PlanningRpc } from "./groups/planning.js";
export { ExternalRpc } from "./groups/external.js";

// --- WorkItem RPCs ---

export {
  WorkItemListRpc,
  WorkItemStatusCountsRpc,
  WorkItemGetRpc,
  WorkItemUpdateRpc,
  WorkItemPromoteToTaskRpc,
  WorkItemCommentListRpc,
  WorkItemCommentCreateRpc,
  WorkItemArtifactCreateRpc,
  WorkItemArtifactListCurrentRpc,
  WorkItemArtifactListChildGroupsRpc,
  WorkItemActivityListRpc,
  WorkItemActivityListRecentRpc,
  WorkItemNotificationListRpc,
  WorkItemNotificationCreateRpc,
  WorkItemNotificationMarkAsReadRpc,
  WorkItemNotificationRegisterPushTokenRpc,
  WorkItemTaskRunListByWorkItemRpc,
  WorkItemTaskRunExecuteRpc,
  WorkItemTaskRunListLifecycleEventsRpc,
  WorkItemRequirementListRpc,
  WorkItemRequirementCreateRpc,
  WorkItemRequirementUpdateRpc,
  WorkItemRequirementDeleteRpc,
  WorkItemRequirementLinkToTaskRpc,
  WorkItemLinkListRpc,
  WorkItemLinkByIdRpc,
  WorkItemLinkByWorktreeRpc,
  WorkItemLinkCreateRpc,
  WorkItemLinkUpdateRpc,
  WorkItemLinkDeleteRpc,
  WorkItemLinkToPlanningTaskRpc,
  WorkItemLinkToGitHubPRRpc,
} from "./groups/work-items.js";

// --- Planning RPCs ---

export {
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
  PlanningSyncLinearProjectsRpc,
  PlanningGetCurrentUserRpc,
  PlanningAgentClaimTaskRpc,
  PlanningAgentReportProgressRpc,
  PlanningAgentCompleteTaskRpc,
  PlanningAgentFailTaskRpc,
  PlanningAgentGetAvailableTasksRpc,
  PlanningAgentStartSessionRpc,
  PlanningAgentEndSessionRpc,
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
  PlanningDispatchCreateBatchRpc,
  PlanningDispatchGetBatchRpc,
  PlanningDispatchUpdateItemAgentRpc,
  PlanningDispatchUpdateConcurrencyRpc,
  PlanningDispatchDispatchRpc,
  PlanningDispatchCheckProgressRpc,
  PlanningDispatchListBatchesRpc,
  PlanningDispatchResetPipelineStateRpc,
  PlanningSkillListRpc,
  PlanningSkillSeedRpc,
  PlanningSkillGetExecutionRpc,
  PlanningSkillListExecutionsRpc,
  PlanningSkillRecordExecutionRpc,
  PlanningSkillUpdateExecutionRpc,
  PlanningSnapshotCreateRpc,
  PlanningSnapshotListRpc,
  PlanningSnapshotGetRpc,
  PlanningCheckpointCreateRpc,
  PlanningCheckpointListRpc,
  PlanningCheckpointBranchFromRpc,
} from "./groups/planning.js";

// --- External RPCs ---

export {
  ExternalListRevisionsRpc,
  ExternalGetRevisionRpc,
  ExternalCreateRevisionRpc,
  ExternalTriggerBuildRpc,
  ExternalUpdateBuildStatusRpc,
  ExternalCreateDeploymentRpc,
  ExternalUpdateDeploymentStatusRpc,
  ExternalIngestRunEventRpc,
  ExternalListDeploymentsRpc,
  ExternalListBuildsRpc,
  ExternalApproveProdDeployRpc,
  ExternalListAppsRpc,
  ExternalListUnlinkedAppsRpc,
  ExternalImportAppRpc,
  WebhookListRpc,
  WebhookByIdRpc,
  WebhookCreateRpc,
  WebhookUpdateRpc,
  WebhookDeleteRpc,
  WebhookDeliveriesRpc,
  WebhookRedeliverRpc,
  WebhookTestRpc,
  PublicApiRegisterWorkspaceRpc,
  PublicApiCreateRunRpc,
  PublicApiUpdateRunRpc,
  PublicApiCreateArtifactRpc,
  PublicApiGetRunRpc,
  PublicApiListRunsRpc,
  PublicApiListRunsByWorkItemRpc,
  PublicApiHeartbeatRpc,
  PublicApiGenerateApiKeyRpc,
  IntegrationListRpc,
  IntegrationGetRpc,
  IntegrationSaveRpc,
  IntegrationFetchLinearTeamsRpc,
  IntegrationSetupLinearRpc,
  IntegrationDeleteRpc,
} from "./groups/external.js";

// --- Schemas: WorkItem ---

export {
  WorkItemKindEnum,
  ProjectSummarySchema,
  WorkItemRecordSchema,
  CommentRecordSchema,
  ArtifactRecordSchema,
  GetWorkItemResultSchema,
} from "./schemas/work-item-core.js";

export {
  ArtifactProducerTypeEnum,
  ArtifactTypeEnum,
  NotificationTypeEnum,
  PushPlatformEnum,
  TaskRunStatusEnum,
  ActivityRecordSchema,
  NotificationRecordSchema,
  TaskRunRecordSchema,
  LifecycleEventRecordSchema,
} from "./schemas/work-item-sub.js";

export {
  RequirementCategoryEnum,
  RequirementStatusEnum,
  RequirementRecordSchema,
} from "./schemas/work-item-requirement.js";

export {
  LinkTypeEnum,
  WorktreeLinkRecordSchema,
} from "./schemas/work-item-link.js";

// --- Schemas: Planning ---

export {
  PlanningStatusEnum,
  PlanningPriorityEnum,
  PlanningKindEnum,
  CycleStatusEnum,
  PlanningWorkspaceRecordSchema,
  PlanningProjectSummarySchema,
  PlanningProjectListItemSchema,
  PlanningProjectDetailSchema,
  PlanningAssigneeSchema,
  PlanningLabelSchema,
  PlanningLabelRecordSchema,
  PlanningTaskRecordSchema,
  PlanningTaskByIdentifierResultSchema,
  PlanningTaskMutationResultSchema,
  PlanningCommentRecordSchema,
  PlanningCommentCreateResultSchema,
  PlanningLinearSyncResultSchema,
  PlanningSearchResultSchema,
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
} from "./schemas/planning-core.js";

export {
  PlanningSessionTypeEnum,
  PlanSessionRecordSchema,
  PlanDraftRecordSchema,
  PlanDraftDependencySchema,
  PlanArtifactResultSchema,
  PriorContextItemSchema,
  PriorContextResultSchema,
  CommitPlanResultSchema,
  CommitPlanLocalResultSchema,
  LaunchContextSchema,
  SessionStartResultSchema,
  SessionGetResultSchema,
  OkResultSchema,
} from "./schemas/planning-session.js";

export {
  PlanStatusEnum,
  PlanTaskStatusEnum,
  PlanTaskPriorityEnum,
  WorktreePlanRecordSchema,
  PlanTaskItemRecordSchema,
  DispatchBatchStatusEnum,
  DispatchItemStatusEnum,
  DispatchBatchRecordSchema,
  DispatchItemRecordSchema,
  DispatchBatchWithItemsSchema,
  DispatchStartedResultSchema,
  SuccessResultSchema,
  SkillCategoryEnum,
  SkillSourceEnum,
  ExecutionStatusEnum,
  SkillRecordSchema,
  SkillExecutionRecordSchema,
  SkillSeedResultSchema,
  WorkItemSnapshotRecordSchema,
  CheckpointRecordSchema,
  BranchFromResultSchema,
} from "./schemas/planning-ops.js";

// --- Schemas: External ---

export {
  RevisionRecordSchema,
  BuildRecordSchema,
  DeploymentRecordSchema,
  ForgeAppRecordSchema,
  ArtifactRefSchema,
  RunEventRecordSchema,
  RevisionDetailSchema,
  ImportedProjectRecordSchema,
  WebhookConfigRecordSchema,
  WebhookDeliveryRecordSchema,
  RunStatusEnum,
  PublicApiArtifactTypeEnum,
  PublicApiRunRecordSchema,
  PublicApiArtifactRecordSchema,
  HeartbeatRepoSchema,
  WorkspaceRegistrationResultSchema,
  ApiKeyResultSchema,
  IntegrationRecordSchema,
  IntegrationMutationResultSchema,
  IntegrationSetupLinearResultSchema,
  IntegrationDeleteResultSchema,
  LinearTeamSchema,
} from "./schemas/external.js";

// --- Stub layers ---

export { WorkItemsStubLayer } from "./stubs/work-items.js";
export { PlanningStubLayer } from "./stubs/planning.js";
export { ExternalStubLayer } from "./stubs/external.js";
