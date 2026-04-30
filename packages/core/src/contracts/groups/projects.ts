// Projects RPC contract group — CRUD over `@gmacko/projects`.
//
// The tagged errors (`ProjectNotFoundError`, `ProjectSlugConflictError`)
// come straight from the source package — they are already
// `Schema.TaggedErrorClass` instances, so they can be used directly as
// the `error:` field without re-declaring them here.
//
// Procedures do NOT take `tenantId` in their payload — the handler reads
// tenancy from `CurrentUser` (populated by `AuthMiddleware`). This keeps
// the wire format clean and avoids clients forging a tenantId.
//
// Phase 7B-4B Task 5: Added project core (get, discovery,
// updateAutomationSettings, dismissDir) and workspace (list, create,
// rename, delete) RPCs — 8 new procedures, 12 total.
//
// Phase 7B-4B Task 6: Added 12 repository RPCs (list, byId, add,
// addFromProvider, delete, refreshMainBranch, getWorktrees,
// createWorktree, getWorktreePlanning, updateWorktreePlanning,
// deleteWorktree, getWorktreeMergeStatus) — 24 total.
//
// Phase 7B-4B Task 7: Added 12 pullRequest RPCs + 7 featureBranch RPCs
// — 43 total.
//
// Phase 7B-4B Task 8: Added 6 gitProvider RPCs + 7 git RPCs — 56 total.
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import {
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from "@gmacko/core/projects/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import { ProjectSchema } from "../schemas/projects.js";
import {
  WorkspaceSchema,
  WorkspaceMemberSchema,
  AutomationSettingsSchema,
  DiscoveryResultSchema,
} from "../schemas/project-workspace.js";
import {
  RepositorySchema,
  WorktreeSchema,
  WorktreePlanSchema,
  WorktreePlanTaskSchema,
  PlanStatusEnum,
} from "../schemas/project-repository.js";
import {
  PullRequestSchema,
  PRReviewSchema,
  PRStatusEnum,
  MergeMethodEnum,
  ReviewStatusEnum,
} from "../schemas/project-pull-request.js";
import {
  FeatureBranchSchema,
  FeatureBranchDetailSchema,
  FeatureBranchListItemSchema,
  FeatureBranchTaskPRSchema,
  FeatureBranchStatusEnum,
} from "../schemas/project-feature-branch.js";
import {
  GitProviderConnectionSchema,
  GitProviderEnum,
  ConnectionTestResultSchema,
  RemoteDetectionResultSchema,
} from "../schemas/project-git-provider.js";
import {
  PushAndCreatePrResultSchema,
  JjCommitSchema,
  JjMutationResultSchema,
  JjDiffResultSchema,
} from "../schemas/project-git.js";

// ---------------------------------------------------------------------------
// Existing project procedures (Phase 6F)
// ---------------------------------------------------------------------------

export const ProjectsCreateRpc = Rpc.make("projects.create", {
  payload: Schema.Struct({
    slug: Schema.String,
    name: Schema.String,
  }),
  success: ProjectSchema,
  error: ProjectSlugConflictError,
});

export const ProjectsListRpc = Rpc.make("projects.list", {
  payload: Schema.Void,
  success: Schema.Array(ProjectSchema),
});

export const ProjectsGetBySlugRpc = Rpc.make("projects.getBySlug", {
  payload: Schema.Struct({ slug: Schema.String }),
  success: ProjectSchema,
  error: ProjectNotFoundError,
});

export const ProjectsDeleteRpc = Rpc.make("projects.delete", {
  payload: Schema.Struct({ projectId: Schema.String }),
  success: Schema.Void,
  error: ProjectNotFoundError,
});

// ---------------------------------------------------------------------------
// New project core procedures (7B-4B Task 5 — from Bob's project router)
// ---------------------------------------------------------------------------

export const ProjectsGetRpc = Rpc.make("projects.get", {
  payload: Schema.Struct({ id: Schema.String }),
  success: ProjectSchema,
  error: ProjectNotFoundError,
});

export const ProjectsDiscoveryRpc = Rpc.make("projects.discovery", {
  payload: Schema.Struct({ workspaceId: Schema.String }),
  success: DiscoveryResultSchema,
});

export const ProjectsUpdateAutomationSettingsRpc = Rpc.make(
  "projects.updateAutomationSettings",
  {
    payload: Schema.Struct({
      projectId: Schema.String,
      settings: AutomationSettingsSchema,
    }),
    success: ProjectSchema,
    error: ProjectNotFoundError,
  },
);

export const ProjectsDismissDirRpc = Rpc.make("projects.dismissDir", {
  payload: Schema.Struct({ dirId: Schema.String }),
  success: Schema.Struct({ ok: Schema.Boolean }),
  error: NotFoundError,
});

// ---------------------------------------------------------------------------
// Workspace procedures (7B-4B Task 5 — from Bob's workspace router)
// ---------------------------------------------------------------------------

export const ProjectsWorkspaceListRpc = Rpc.make("projects.workspace.list", {
  payload: Schema.Void,
  success: Schema.Array(WorkspaceMemberSchema),
});

export const ProjectsWorkspaceCreateRpc = Rpc.make(
  "projects.workspace.create",
  {
    payload: Schema.Struct({
      name: Schema.String,
      slug: Schema.String,
      description: Schema.optional(Schema.String),
    }),
    success: WorkspaceSchema,
  },
);

export const ProjectsWorkspaceRenameRpc = Rpc.make(
  "projects.workspace.rename",
  {
    payload: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
    success: WorkspaceSchema,
  },
);

export const ProjectsWorkspaceDeleteRpc = Rpc.make(
  "projects.workspace.delete",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Repository procedures (7B-4B Task 6 — from Bob's repository router)
// ---------------------------------------------------------------------------

export const ProjectsRepositoryListRpc = Rpc.make("projects.repository.list", {
  payload: Schema.Void,
  success: Schema.Array(RepositorySchema),
});

export const ProjectsRepositoryByIdRpc = Rpc.make(
  "projects.repository.byId",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: RepositorySchema,
    error: NotFoundError,
  },
);

export const ProjectsRepositoryAddRpc = Rpc.make("projects.repository.add", {
  payload: Schema.Struct({ repositoryPath: Schema.String }),
  success: RepositorySchema,
});

export const ProjectsRepositoryAddFromProviderRpc = Rpc.make(
  "projects.repository.addFromProvider",
  {
    payload: Schema.Struct({
      fullName: Schema.String,
      cloneUrl: Schema.String,
      htmlUrl: Schema.String,
      defaultBranch: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.String),
      instanceUrl: Schema.optional(Schema.String),
      projectId: Schema.optional(Schema.String),
    }),
    success: RepositorySchema,
  },
);

export const ProjectsRepositoryDeleteRpc = Rpc.make(
  "projects.repository.delete",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

export const ProjectsRepositoryRefreshMainBranchRpc = Rpc.make(
  "projects.repository.refreshMainBranch",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: RepositorySchema,
    error: NotFoundError,
  },
);

export const ProjectsRepositoryGetWorktreesRpc = Rpc.make(
  "projects.repository.getWorktrees",
  {
    payload: Schema.Struct({ repositoryId: Schema.String }),
    success: Schema.Array(WorktreeSchema),
  },
);

export const ProjectsRepositoryCreateWorktreeRpc = Rpc.make(
  "projects.repository.createWorktree",
  {
    payload: Schema.Struct({
      repositoryId: Schema.String,
      branchName: Schema.String,
      baseBranch: Schema.optional(Schema.String),
      agentType: Schema.optional(Schema.String),
      planning: Schema.optional(
        Schema.Struct({
          title: Schema.optional(Schema.String),
          goal: Schema.optional(Schema.String),
          planningTaskId: Schema.optional(Schema.String),
          tasks: Schema.optional(Schema.Array(WorktreePlanTaskSchema)),
        }),
      ),
    }),
    success: WorktreeSchema,
    error: NotFoundError,
  },
);

export const ProjectsRepositoryGetWorktreePlanningRpc = Rpc.make(
  "projects.repository.getWorktreePlanning",
  {
    payload: Schema.Struct({ worktreeId: Schema.String }),
    success: Schema.Struct({
      exists: Schema.Boolean,
      path: Schema.String,
      content: Schema.NullOr(Schema.String),
      parsed: Schema.NullOr(
        Schema.Struct({
          frontmatter: Schema.Unknown,
          title: Schema.optional(Schema.String),
          goal: Schema.optional(Schema.String),
          tasks: Schema.Array(WorktreePlanTaskSchema),
        }),
      ),
      dbRecord: Schema.NullOr(WorktreePlanSchema),
    }),
    error: NotFoundError,
  },
);

export const ProjectsRepositoryUpdateWorktreePlanningRpc = Rpc.make(
  "projects.repository.updateWorktreePlanning",
  {
    payload: Schema.Struct({
      worktreeId: Schema.String,
      content: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
      goal: Schema.optional(Schema.String),
      status: Schema.optional(PlanStatusEnum),
      planningTaskId: Schema.optional(Schema.NullOr(Schema.String)),
      tasks: Schema.optional(Schema.Array(WorktreePlanTaskSchema)),
    }),
    success: Schema.Struct({
      success: Schema.Boolean,
      plan: Schema.NullOr(WorktreePlanSchema),
      path: Schema.String,
    }),
    error: NotFoundError,
  },
);

export const ProjectsRepositoryDeleteWorktreeRpc = Rpc.make(
  "projects.repository.deleteWorktree",
  {
    payload: Schema.Struct({
      worktreeId: Schema.String,
      force: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
    error: NotFoundError,
  },
);

export const ProjectsRepositoryGetWorktreeMergeStatusRpc = Rpc.make(
  "projects.repository.getWorktreeMergeStatus",
  {
    payload: Schema.Struct({ worktreeId: Schema.String }),
    success: Schema.Struct({
      merged: Schema.Boolean,
      hasUncommittedChanges: Schema.Boolean,
    }),
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Pull-request procedures (7B-4B Task 7 — from Bob's pullRequest router)
// ---------------------------------------------------------------------------

export const ProjectsPullRequestListRpc = Rpc.make(
  "projects.pullRequest.list",
  {
    payload: Schema.Struct({
      status: Schema.optional(PRStatusEnum),
      limit: Schema.optional(Schema.Number),
    }),
    success: Schema.Array(PullRequestSchema),
  },
);

export const ProjectsPullRequestGetRpc = Rpc.make(
  "projects.pullRequest.get",
  {
    payload: Schema.Struct({ pullRequestId: Schema.String }),
    success: PullRequestSchema,
    error: NotFoundError,
  },
);

export const ProjectsPullRequestListByRepositoryRpc = Rpc.make(
  "projects.pullRequest.listByRepository",
  {
    payload: Schema.Struct({
      repositoryId: Schema.String,
      status: Schema.optional(PRStatusEnum),
      limit: Schema.optional(Schema.Number),
      includeCommits: Schema.optional(Schema.Boolean),
    }),
    success: Schema.Array(PullRequestSchema),
  },
);

export const ProjectsPullRequestListBySessionRpc = Rpc.make(
  "projects.pullRequest.listBySession",
  {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: Schema.Array(PullRequestSchema),
  },
);

export const ProjectsPullRequestCreateRpc = Rpc.make(
  "projects.pullRequest.create",
  {
    payload: Schema.Struct({
      repositoryId: Schema.String,
      sessionId: Schema.optional(Schema.String),
      title: Schema.String,
      body: Schema.optional(Schema.String),
      headBranch: Schema.String,
      baseBranch: Schema.optional(Schema.String),
      draft: Schema.optional(Schema.Boolean),
      planningTaskId: Schema.optional(Schema.String),
    }),
    success: PullRequestSchema,
  },
);

export const ProjectsPullRequestUpdateRpc = Rpc.make(
  "projects.pullRequest.update",
  {
    payload: Schema.Struct({
      pullRequestId: Schema.String,
      title: Schema.optional(Schema.String),
      body: Schema.optional(Schema.String),
      state: Schema.optional(Schema.Literal("open", "closed")),
    }),
    success: PullRequestSchema,
    error: NotFoundError,
  },
);

export const ProjectsPullRequestMergeRpc = Rpc.make(
  "projects.pullRequest.merge",
  {
    payload: Schema.Struct({
      pullRequestId: Schema.String,
      mergeMethod: Schema.optional(MergeMethodEnum),
    }),
    success: PullRequestSchema,
    error: NotFoundError,
  },
);

export const ProjectsPullRequestSyncCommitsRpc = Rpc.make(
  "projects.pullRequest.syncCommits",
  {
    payload: Schema.Struct({ pullRequestId: Schema.String }),
    success: PullRequestSchema,
    error: NotFoundError,
  },
);

export const ProjectsPullRequestLinkToPlanningTaskRpc = Rpc.make(
  "projects.pullRequest.linkToPlanningTask",
  {
    payload: Schema.Struct({
      pullRequestId: Schema.String,
      planningTaskId: Schema.String,
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
  },
);

export const ProjectsPullRequestRefreshRpc = Rpc.make(
  "projects.pullRequest.refresh",
  {
    payload: Schema.Struct({ pullRequestId: Schema.String }),
    success: PullRequestSchema,
    error: NotFoundError,
  },
);

export const ProjectsPullRequestListReviewsRpc = Rpc.make(
  "projects.pullRequest.listReviews",
  {
    payload: Schema.Struct({ pullRequestId: Schema.String }),
    success: Schema.Array(PRReviewSchema),
    error: NotFoundError,
  },
);

export const ProjectsPullRequestAddReviewRpc = Rpc.make(
  "projects.pullRequest.addReview",
  {
    payload: Schema.Struct({
      pullRequestId: Schema.String,
      status: ReviewStatusEnum,
      body: Schema.optional(Schema.String),
    }),
    success: PRReviewSchema,
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Feature-branch procedures (7B-4B Task 7 — from Bob's featureBranch router)
// ---------------------------------------------------------------------------

export const ProjectsFeatureBranchCreateRpc = Rpc.make(
  "projects.featureBranch.create",
  {
    payload: Schema.Struct({
      workItemId: Schema.String,
      repositoryId: Schema.String,
      branchName: Schema.String,
      baseBranch: Schema.optional(Schema.String),
    }),
    success: FeatureBranchSchema,
  },
);

export const ProjectsFeatureBranchGetRpc = Rpc.make(
  "projects.featureBranch.get",
  {
    payload: Schema.Struct({ id: Schema.String }),
    success: FeatureBranchDetailSchema,
    error: NotFoundError,
  },
);

export const ProjectsFeatureBranchListRpc = Rpc.make(
  "projects.featureBranch.list",
  {
    payload: Schema.Struct({ workItemId: Schema.String }),
    success: Schema.Array(FeatureBranchListItemSchema),
  },
);

export const ProjectsFeatureBranchAddTaskPRRpc = Rpc.make(
  "projects.featureBranch.addTaskPR",
  {
    payload: Schema.Struct({
      featureBranchId: Schema.String,
      pullRequestId: Schema.String,
    }),
    success: FeatureBranchTaskPRSchema,
    error: NotFoundError,
  },
);

export const ProjectsFeatureBranchMarkTaskPRMergedRpc = Rpc.make(
  "projects.featureBranch.markTaskPRMerged",
  {
    payload: Schema.Struct({
      featureBranchId: Schema.String,
      pullRequestId: Schema.String,
    }),
    success: FeatureBranchTaskPRSchema,
    error: NotFoundError,
  },
);

export const ProjectsFeatureBranchCreateFeaturePRRpc = Rpc.make(
  "projects.featureBranch.createFeaturePR",
  {
    payload: Schema.Struct({
      featureBranchId: Schema.String,
      title: Schema.String,
      repositoryId: Schema.String,
    }),
    success: Schema.Struct({
      featureBranch: FeatureBranchSchema,
      pullRequest: PullRequestSchema,
    }),
    error: NotFoundError,
  },
);

export const ProjectsFeatureBranchUpdateStatusRpc = Rpc.make(
  "projects.featureBranch.updateStatus",
  {
    payload: Schema.Struct({
      id: Schema.String,
      status: FeatureBranchStatusEnum,
    }),
    success: FeatureBranchSchema,
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Git-provider procedures (7B-4B Task 8 — from Bob's gitProviders router)
// ---------------------------------------------------------------------------

export const ProjectsGitProviderListConnectionsRpc = Rpc.make(
  "projects.gitProvider.listConnections",
  {
    payload: Schema.Void,
    success: Schema.Array(GitProviderConnectionSchema),
  },
);

export const ProjectsGitProviderConnectPatRpc = Rpc.make(
  "projects.gitProvider.connectPat",
  {
    payload: Schema.Struct({
      provider: GitProviderEnum,
      accessToken: Schema.String,
      instanceUrl: Schema.optional(Schema.String),
    }),
    success: GitProviderConnectionSchema,
  },
);

export const ProjectsGitProviderDisconnectRpc = Rpc.make(
  "projects.gitProvider.disconnect",
  {
    payload: Schema.Struct({ connectionId: Schema.String }),
    success: Schema.Struct({ success: Schema.Boolean }),
    error: NotFoundError,
  },
);

export const ProjectsGitProviderTestConnectionRpc = Rpc.make(
  "projects.gitProvider.testConnection",
  {
    payload: Schema.Struct({
      connectionId: Schema.optional(Schema.String),
      provider: Schema.optional(GitProviderEnum),
      instanceUrl: Schema.optional(Schema.String),
    }),
    success: ConnectionTestResultSchema,
  },
);

export const ProjectsGitProviderSetDefaultForRepoRpc = Rpc.make(
  "projects.gitProvider.setDefaultForRepo",
  {
    payload: Schema.Struct({
      repositoryId: Schema.String,
      connectionId: Schema.String,
    }),
    success: Schema.Struct({ success: Schema.Boolean }),
    error: NotFoundError,
  },
);

export const ProjectsGitProviderDetectRemoteRpc = Rpc.make(
  "projects.gitProvider.detectRemote",
  {
    payload: Schema.Struct({ repositoryId: Schema.String }),
    success: RemoteDetectionResultSchema,
    error: NotFoundError,
  },
);

// ---------------------------------------------------------------------------
// Git procedures (7B-4B Task 8 — from Bob's git router)
// ---------------------------------------------------------------------------

export const ProjectsGitPushAndCreatePrRpc = Rpc.make(
  "projects.git.pushAndCreatePr",
  {
    payload: Schema.Struct({
      repositoryId: Schema.String,
      path: Schema.String,
      sessionId: Schema.optional(Schema.String),
      title: Schema.String,
      body: Schema.optional(Schema.String),
      headBranch: Schema.String,
      baseBranch: Schema.optional(Schema.String),
      draft: Schema.optional(Schema.Boolean),
      planningTaskId: Schema.optional(Schema.String),
    }),
    success: PushAndCreatePrResultSchema,
    error: NotFoundError,
  },
);

export const ProjectsGitJjIsRepoRpc = Rpc.make("projects.git.jjIsRepo", {
  payload: Schema.Struct({ path: Schema.String }),
  success: Schema.Boolean,
});

export const ProjectsGitJjLogRpc = Rpc.make("projects.git.jjLog", {
  payload: Schema.Struct({
    path: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  success: Schema.Array(JjCommitSchema),
});

export const ProjectsGitJjNewRpc = Rpc.make("projects.git.jjNew", {
  payload: Schema.Struct({
    path: Schema.String,
    description: Schema.optional(Schema.String),
  }),
  success: JjMutationResultSchema,
});

export const ProjectsGitJjDescribeRpc = Rpc.make("projects.git.jjDescribe", {
  payload: Schema.Struct({
    path: Schema.String,
    description: Schema.String,
    revision: Schema.optional(Schema.String),
  }),
  success: JjMutationResultSchema,
});

export const ProjectsGitJjSquashRpc = Rpc.make("projects.git.jjSquash", {
  payload: Schema.Struct({ path: Schema.String }),
  success: JjMutationResultSchema,
});

export const ProjectsGitJjDiffRpc = Rpc.make("projects.git.jjDiff", {
  payload: Schema.Struct({
    path: Schema.String,
    revision: Schema.optional(Schema.String),
  }),
  success: JjDiffResultSchema,
});

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export const ProjectsRpc = RpcGroup.make(
  // Existing (Phase 6F)
  ProjectsCreateRpc,
  ProjectsListRpc,
  ProjectsGetBySlugRpc,
  ProjectsDeleteRpc,
  // Project core (7B-4B Task 5)
  ProjectsGetRpc,
  ProjectsDiscoveryRpc,
  ProjectsUpdateAutomationSettingsRpc,
  ProjectsDismissDirRpc,
  // Workspace (7B-4B Task 5)
  ProjectsWorkspaceListRpc,
  ProjectsWorkspaceCreateRpc,
  ProjectsWorkspaceRenameRpc,
  ProjectsWorkspaceDeleteRpc,
  // Repository (7B-4B Task 6)
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
  // Pull request (7B-4B Task 7)
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
  // Feature branch (7B-4B Task 7)
  ProjectsFeatureBranchCreateRpc,
  ProjectsFeatureBranchGetRpc,
  ProjectsFeatureBranchListRpc,
  ProjectsFeatureBranchAddTaskPRRpc,
  ProjectsFeatureBranchMarkTaskPRMergedRpc,
  ProjectsFeatureBranchCreateFeaturePRRpc,
  ProjectsFeatureBranchUpdateStatusRpc,
  // Git provider (7B-4B Task 8)
  ProjectsGitProviderListConnectionsRpc,
  ProjectsGitProviderConnectPatRpc,
  ProjectsGitProviderDisconnectRpc,
  ProjectsGitProviderTestConnectionRpc,
  ProjectsGitProviderSetDefaultForRepoRpc,
  ProjectsGitProviderDetectRemoteRpc,
  // Git (7B-4B Task 8)
  ProjectsGitPushAndCreatePrRpc,
  ProjectsGitJjIsRepoRpc,
  ProjectsGitJjLogRpc,
  ProjectsGitJjNewRpc,
  ProjectsGitJjDescribeRpc,
  ProjectsGitJjSquashRpc,
  ProjectsGitJjDiffRpc,
);
