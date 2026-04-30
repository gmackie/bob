export * from "./rpc";
export * from "./errors";
export * from "./schemas/thread";
export * from "./schemas/branch";
export * from "./schemas/message";
export * from "./schemas/wiki";
export * from "./schemas/exploration";

// --- Phase 6F: Auth ------------------------------------------------------
// Auth group — kept as a distinct export (NOT merged into GmackoRpcGroup).
// Rationale: one RpcGroup per service lets consumers tree-shake clients
// per-group (`@gmacko/client/auth` can import just `AuthRpc`).
export { AuthRpc } from "./groups/auth";
export {
  AuthWhoAmIRpc,
  AuthListMembershipsRpc,
  AuthResolveTenantRpc,
  AuthIssueApiKeyRpc,
  AuthListApiKeysRpc,
  AuthRevokeApiKeyRpc,
  AuthStartDeviceFlowRpc,
  AuthPollDeviceCodeRpc,
  AuthApproveDeviceCodeRpc,
} from "./groups/auth";
export { stubAuthHandlers } from "./stubs/auth";
export {
  CurrentUserSchema,
  MembershipSchema,
  ApiKeyListItemSchema,
  ApiKeyIssueResultSchema,
  DeviceCodePollResultSchema,
  DeviceFlowStartResultSchema,
} from "./schemas/auth";
export type {
  CurrentUserWire,
  MembershipWire,
  ApiKeyListItemWire,
  ApiKeyIssueResultWire,
  DeviceCodePollResultWire,
  DeviceFlowStartResultWire,
} from "./schemas/auth";

// --- Projects ------------------------------------------------------------
// Standalone RpcGroup (not merged into GmackoRpcGroup) to preserve the
// one-group-per-service tree-shaking story. Other 6F groups (auth,
// secrets, agent) land their own export blocks alongside this one.
export {
  ProjectsRpc,
  ProjectsCreateRpc,
  ProjectsListRpc,
  ProjectsGetBySlugRpc,
  ProjectsDeleteRpc,
  // 7B-4B Task 5 — project core
  ProjectsGetRpc,
  ProjectsDiscoveryRpc,
  ProjectsUpdateAutomationSettingsRpc,
  ProjectsDismissDirRpc,
  // 7B-4B Task 5 — workspace
  ProjectsWorkspaceListRpc,
  ProjectsWorkspaceCreateRpc,
  ProjectsWorkspaceRenameRpc,
  ProjectsWorkspaceDeleteRpc,
  // 7B-4B Task 6 — repository
  ProjectsRepositoryListRpc,
  ProjectsRepositoryByIdRpc,
  ProjectsRepositoryAddRpc,
  ProjectsRepositoryAddFromProviderRpc,
  ProjectsRepositoryDeleteRpc,
  ProjectsRepositoryRefreshMainBranchRpc,
  ProjectsRepositoryGetWorktreesRpc,
  ProjectsRepositoryCreateWorktreeRpc,
  ProjectsRepositoryGetWorktreePlanningRpc,
  ProjectsRepositoryUpdateWorktreePlanningRpc,
  ProjectsRepositoryDeleteWorktreeRpc,
  ProjectsRepositoryGetWorktreeMergeStatusRpc,
  // 7B-4B Task 7 — pull request
  ProjectsPullRequestListRpc,
  ProjectsPullRequestGetRpc,
  ProjectsPullRequestListByRepositoryRpc,
  ProjectsPullRequestListBySessionRpc,
  ProjectsPullRequestCreateRpc,
  ProjectsPullRequestUpdateRpc,
  ProjectsPullRequestMergeRpc,
  ProjectsPullRequestSyncCommitsRpc,
  ProjectsPullRequestLinkToPlanningTaskRpc,
  ProjectsPullRequestRefreshRpc,
  ProjectsPullRequestListReviewsRpc,
  ProjectsPullRequestAddReviewRpc,
  // 7B-4B Task 7 — feature branch
  ProjectsFeatureBranchCreateRpc,
  ProjectsFeatureBranchGetRpc,
  ProjectsFeatureBranchListRpc,
  ProjectsFeatureBranchAddTaskPRRpc,
  ProjectsFeatureBranchMarkTaskPRMergedRpc,
  ProjectsFeatureBranchCreateFeaturePRRpc,
  ProjectsFeatureBranchUpdateStatusRpc,
  // 7B-4B Task 8 — git provider
  ProjectsGitProviderListConnectionsRpc,
  ProjectsGitProviderConnectPatRpc,
  ProjectsGitProviderDisconnectRpc,
  ProjectsGitProviderTestConnectionRpc,
  ProjectsGitProviderSetDefaultForRepoRpc,
  ProjectsGitProviderDetectRemoteRpc,
  // 7B-4B Task 8 — git
  ProjectsGitPushAndCreatePrRpc,
  ProjectsGitJjIsRepoRpc,
  ProjectsGitJjLogRpc,
  ProjectsGitJjNewRpc,
  ProjectsGitJjDescribeRpc,
  ProjectsGitJjSquashRpc,
  ProjectsGitJjDiffRpc,
} from "./groups/projects";
export {
  stubProjectsHandlers,
  stubProjectsHandlersLayer,
  STUB_PROJECT_1,
  STUB_PROJECT_2,
  STUB_TENANT_ID as STUB_PROJECTS_TENANT_ID,
  // 7B-4B Task 5 — workspace stubs
  STUB_WORKSPACE_1,
  STUB_WORKSPACE_MEMBER_1,
  STUB_DISCOVERY_RESULT,
  // 7B-4B Task 6 — repository stubs
  STUB_REPOSITORY_1,
  STUB_WORKTREE_1,
  STUB_WORKTREE_PLAN_1,
  // 7B-4B Task 7 — pull request + feature branch stubs
  STUB_PULL_REQUEST_1,
  STUB_PR_REVIEW_1,
  STUB_FEATURE_BRANCH_1,
  STUB_FEATURE_BRANCH_TASK_PR_1,
  // 7B-4B Task 8 — git provider + git stubs
  STUB_GIT_PROVIDER_CONNECTION_1,
  STUB_JJ_COMMIT_1,
} from "./stubs/projects";
export { ProjectSchema } from "./schemas/projects";
export type { ProjectWire } from "./schemas/projects";
export {
  WorkspaceSchema,
  WorkspaceMemberSchema,
  AutomationSettingsSchema,
  StageSkillSchema,
  DiscoveryResultSchema,
  DiscoveryRepoSchema,
  DiscoveryLinkedRepoSchema,
  DiscoveredDirSchema,
} from "./schemas/project-workspace";
export type {
  WorkspaceWire,
  WorkspaceMemberWire,
  AutomationSettingsWire,
  DiscoveryResultWire,
} from "./schemas/project-workspace";
export {
  RepositorySchema,
  WorktreeSchema,
  WorktreePlanSchema,
  WorktreePlanTaskSchema,
  PlanStatusEnum,
  PlanTaskStatusEnum,
} from "./schemas/project-repository";
export type {
  RepositoryWire,
  WorktreeWire,
  WorktreePlanWire,
  WorktreePlanTaskWire,
  PlanStatus,
  PlanTaskStatus,
} from "./schemas/project-repository";
export {
  PullRequestSchema,
  PRReviewSchema,
  PRStatusEnum,
  MergeMethodEnum,
  ReviewStatusEnum,
} from "./schemas/project-pull-request";
export type {
  PullRequestWire,
  PRReviewWire,
  PRStatus,
  MergeMethod,
  ReviewStatus,
} from "./schemas/project-pull-request";
export {
  FeatureBranchSchema,
  FeatureBranchTaskPRSchema,
  FeatureBranchListItemSchema,
  FeatureBranchDetailSchema,
  FeatureBranchStatusEnum,
} from "./schemas/project-feature-branch";
export type {
  FeatureBranchWire,
  FeatureBranchTaskPRWire,
  FeatureBranchListItemWire,
  FeatureBranchDetailWire,
  FeatureBranchStatus,
} from "./schemas/project-feature-branch";
export {
  GitProviderConnectionSchema,
  GitProviderEnum,
  ConnectionTestResultSchema,
  RemoteDetectionResultSchema,
} from "./schemas/project-git-provider";
export type {
  GitProviderConnectionWire,
  GitProvider,
  ConnectionTestResultWire,
  RemoteDetectionResultWire,
} from "./schemas/project-git-provider";
export {
  PushAndCreatePrResultSchema,
  JjCommitSchema,
  JjMutationResultSchema,
  JjDiffResultSchema,
} from "./schemas/project-git";
export type {
  PushAndCreatePrResultWire,
  JjCommitWire,
  JjMutationResultWire,
  JjDiffResultWire,
} from "./schemas/project-git";

// --- Agent (7B-4B) -------------------------------------------------------
// Agent schemas added alongside the AgentRpc group. The group itself is
// exported via `@gmacko/core/contracts/groups/agent`.
export { AgentRunSchema } from "./schemas/agent-run";
export type { AgentRunWire } from "./schemas/agent-run";
export { CaptureTargetSchema, CaptureResultSchema } from "./schemas/agent-capture";
export type { CaptureTargetWire, CaptureResultWire } from "./schemas/agent-capture";
export {
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
} from "./schemas/agent-session";
export type {
  SessionWire,
  SessionEventWire,
  SessionConnectionWire,
  SessionStatus,
  EventDirection,
  WorkflowStatus,
  WorkflowStateWire,
  ArtifactType,
  ArtifactRole,
} from "./schemas/agent-session";
export {
  AgentInstanceSchema,
  InstanceStatusEnum,
  AgentTypeEnum,
} from "./schemas/agent-instance";
export type {
  AgentInstanceWire,
  InstanceStatus,
  AgentType,
} from "./schemas/agent-instance";
export {
  AgentTerminalSessionSchema,
  DirectoryTerminalSessionSchema,
  SystemTerminalSessionSchema,
} from "./schemas/agent-terminal";
export type {
  AgentTerminalSessionWire,
  DirectoryTerminalSessionWire,
  SystemTerminalSessionWire,
} from "./schemas/agent-terminal";
export {
  EventLogSchema,
  EventTypeEnum,
  EventStatsSchema,
} from "./schemas/agent-event";
export type {
  EventLogWire,
  EventType,
  EventStatsWire,
} from "./schemas/agent-event";
export {
  FileEntrySchema,
  GitStatusEntrySchema,
  FileSearchResultSchema,
} from "./schemas/agent-filesystem";
export type {
  FileEntryWire,
  GitStatusEntryWire,
  FileSearchResultWire,
} from "./schemas/agent-filesystem";
export { ChatAttachmentSchema } from "./schemas/agent-chat";
export type { ChatAttachmentWire } from "./schemas/agent-chat";
export { PostSchema } from "./schemas/agent-post";
export type { PostWire } from "./schemas/agent-post";

// --- Secrets -------------------------------------------------------------
// Standalone RpcGroup. `secrets.decryptForUse` is the only plaintext-returning
// procedure — its error channel is a Schema.Union of SecretNotFoundError |
// PolicyDeniedError | MaxUsesExceededError (array-arg form, verified in
// effect@4.0.0-beta.43).
export {
  SecretsRpc,
  SecretsCreateRpc,
  SecretsListRpc,
  SecretsGetEnvelopeRpc,
  SecretsDecryptForUseRpc,
  SecretsMarkUsedRpc,
  SecretsDeleteRpc,
} from "./groups/secrets";
export {
  stubSecretsHandlers,
  layerStubSecretsHandlers,
  STUB_SECRET_ENVELOPE_1,
  STUB_SECRET_ENVELOPE_2,
  STUB_SECRET_ID_1,
  STUB_SECRET_ID_2,
  STUB_CONFLICT_NAME,
  STUB_TENANT_ID as STUB_SECRETS_TENANT_ID,
} from "./stubs/secrets";
export {
  SecretEnvelopeSchema,
  SessionSecretPolicySchema,
} from "./schemas/secrets";
export type {
  SecretEnvelopeWire,
  SessionSecretPolicyWire,
} from "./schemas/secrets";
