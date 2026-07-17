// Deterministic stub handlers for `ProjectsRpc`.
//
// Mounted by consumers via
//   `RpcServer.layerHttp({ group: ProjectsRpc, handlers: stubProjectsHandlersLayer })`.
//
// The handlers are also exported as a plain record (`stubProjectsHandlers`)
// so tests can invoke them directly without spinning up an RpcServer — the
// same record is passed to `ProjectsRpc.toLayer(...)` to produce the
// mountable handlers layer (`stubProjectsHandlersLayer`).
//
// Phase 7B-4B Task 5: Added stubs for 8 new procedures (project core +
// workspace) — 12 handlers total.
//
// Phase 7B-4B Task 6: Added stubs for 12 repository procedures — 24
// handlers total.
//
// Phase 7B-4B Task 7: Added stubs for 12 pullRequest + 7 featureBranch
// procedures — 43 handlers total.
//
// Phase 7B-4B Task 8: Added stubs for 6 gitProvider + 7 git procedures
// — 56 handlers total.
import { DateTime, Effect } from "effect";

import { ProjectNotFoundError } from "@gmacko/core/projects/errors";
import { NotFoundError } from "@gmacko/core/rpc/errors";

import { ProjectsRpc } from "../groups/projects.js";
import type { ProjectWire } from "../schemas/projects.js";
import type {
  WorkspaceWire,
  WorkspaceMemberWire,
  DiscoveryResultWire,
} from "../schemas/project-workspace.js";
import type {
  RepositoryWire,
  WorktreeWire,
  WorktreePlanWire,
} from "../schemas/project-repository.js";
import type { PullRequestWire, PRReviewWire } from "../schemas/project-pull-request.js";
import type {
  FeatureBranchWire,
  FeatureBranchTaskPRWire,
  FeatureBranchListItemWire,
  FeatureBranchDetailWire,
} from "../schemas/project-feature-branch.js";
import type { GitProviderConnectionWire, ConnectionTestResultWire, RemoteDetectionResultWire } from "../schemas/project-git-provider.js";
import type { PushAndCreatePrResultWire, JjCommitWire, JjMutationResultWire, JjDiffResultWire } from "../schemas/project-git.js";

export const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const STUB_DATE_TIME = DateTime.makeUnsafe("2026-04-21T12:00:00Z");

export const STUB_PROJECT_1: ProjectWire = {
  id: "11111111-1111-1111-1111-111111111111",
  tenantId: STUB_TENANT_ID,
  slug: "acme",
  name: "Acme",
  createdAt: new Date("2026-04-21T12:00:00Z"),
  updatedAt: new Date("2026-04-21T12:00:00Z"),
};

export const STUB_PROJECT_2: ProjectWire = {
  id: "22222222-2222-2222-2222-222222222222",
  tenantId: STUB_TENANT_ID,
  slug: "oodadocs",
  name: "OODA Docs",
  createdAt: new Date("2026-04-20T12:00:00Z"),
  updatedAt: new Date("2026-04-20T12:00:00Z"),
};

const STUB_CREATED_PROJECT_ID = "99999999-9999-9999-9999-999999999999";

export const STUB_WORKSPACE_1: WorkspaceWire = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  ownerUserId: "00000000-0000-0000-0000-000000000099",
  name: "Acme Workspace",
  slug: "acme-ws",
  description: null,
  createdAt: STUB_DATE_TIME,
  updatedAt: STUB_DATE_TIME,
};

export const STUB_WORKSPACE_MEMBER_1: WorkspaceMemberWire = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  workspaceId: STUB_WORKSPACE_1.id,
  userId: "00000000-0000-0000-0000-000000000099",
  role: "owner",
  joinedAt: STUB_DATE_TIME,
  workspace: STUB_WORKSPACE_1,
};

export const STUB_DISCOVERY_RESULT: DiscoveryResultWire = {
  forgeAvailable: false,
  linked: [],
  forgeReady: [],
  gitOnly: [],
  nonGit: [],
};

export const STUB_REPOSITORY_1: RepositoryWire = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  userId: "00000000-0000-0000-0000-000000000099",
  planningProjectId: null,
  name: "acme-repo",
  path: "/home/mackieg/repos/acme-repo",
  branch: "main",
  mainBranch: "main",
  remoteUrl: "https://github.com/acme/acme-repo.git",
  remoteProvider: "github",
  remoteOwner: "acme",
  remoteName: "acme-repo",
  remoteInstanceUrl: null,
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: null,
};

export const STUB_WORKTREE_1: WorktreeWire = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  userId: "00000000-0000-0000-0000-000000000099",
  repositoryId: STUB_REPOSITORY_1.id,
  path: "/home/mackieg/.bob/acme-repo-feat-1",
  branch: "feat-1",
  preferredAgent: "claude",
  isMainWorktree: false,
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: null,
};

export const STUB_PULL_REQUEST_1: PullRequestWire = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  userId: "00000000-0000-0000-0000-000000000099",
  repositoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  sessionId: null,
  title: "feat: add widget support",
  body: "Adds the widget feature.",
  headBranch: "feat/widgets",
  baseBranch: "main",
  status: "open",
  remoteNumber: 42,
  remoteUrl: "https://github.com/acme/acme-repo/pull/42",
  mergedAt: null,
  planningTaskId: null,
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: null,
};

export const STUB_PR_REVIEW_1: PRReviewWire = {
  id: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
  pullRequestId: STUB_PULL_REQUEST_1.id,
  userId: "00000000-0000-0000-0000-000000000099",
  status: "approved",
  body: "LGTM",
  createdAt: "2026-04-21T13:00:00Z",
  userName: "Test User",
  userImage: null,
};

export const STUB_FEATURE_BRANCH_1: FeatureBranchWire = {
  id: "ffffffff-aaaa-bbbb-cccc-dddddddddddd",
  workItemId: "11111111-aaaa-bbbb-cccc-dddddddddddd",
  repositoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  branchName: "feature/acme-widgets",
  baseBranch: "main",
  status: "active",
  featurePrId: null,
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: null,
};

export const STUB_FEATURE_BRANCH_TASK_PR_1: FeatureBranchTaskPRWire = {
  id: "ffffffff-aaaa-bbbb-cccc-eeeeeeeeeeee",
  featureBranchId: STUB_FEATURE_BRANCH_1.id,
  pullRequestId: STUB_PULL_REQUEST_1.id,
  mergedAt: null,
  createdAt: "2026-04-21T12:00:00Z",
  pullRequest: STUB_PULL_REQUEST_1,
};

export const STUB_GIT_PROVIDER_CONNECTION_1: GitProviderConnectionWire = {
  id: "gggggggg-gggg-gggg-gggg-gggggggggggg",
  provider: "github",
  instanceUrl: null,
  providerAccountId: "12345",
  providerUsername: "acme-dev",
};

export const STUB_JJ_COMMIT_1: JjCommitWire = {
  changeId: "abcdef1234567890",
  commitId: "1234567890abcdef",
  description: "Initial commit",
  author: "Test User <test@example.com>",
  timestamp: "2026-04-21T12:00:00Z",
  branches: ["main"],
  isWorkingCopy: true,
};

export const STUB_WORKTREE_PLAN_1: WorktreePlanWire = {
  id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  worktreeId: STUB_WORKTREE_1.id,
  userId: "00000000-0000-0000-0000-000000000099",
  filePath: "/home/mackieg/.bob/acme-repo-feat-1/planning.md",
  title: "Feature 1",
  goal: "Implement feature 1",
  status: "active",
  planningTaskId: null,
  lastSyncedAt: "2026-04-21T12:00:00Z",
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: null,
};

/**
 * Deterministic handler record. Exported so tests can invoke handlers
 * directly; production code passes this to `ProjectsRpc.toLayer(...)` via
 * `stubProjectsHandlersLayer`.
 */
export const stubProjectsHandlers = {
  // --- Existing (Phase 6F) -----------------------------------------------
  "projects.create": ({ slug, name }: { slug: string; name: string }) => {
    const now = new Date("2026-04-21T12:00:00Z");
    return Effect.succeed({
      id: STUB_CREATED_PROJECT_ID,
      tenantId: STUB_TENANT_ID,
      slug,
      name,
      createdAt: now,
      updatedAt: now,
    } satisfies ProjectWire);
  },
  "projects.list": () =>
    Effect.succeed([STUB_PROJECT_1, STUB_PROJECT_2] as const),
  "projects.getBySlug": ({ slug }: { slug: string }) => {
    if (slug === STUB_PROJECT_1.slug) return Effect.succeed(STUB_PROJECT_1);
    if (slug === STUB_PROJECT_2.slug) return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: slug,
      }),
    );
  },
  "projects.delete": ({ projectId }: { projectId: string }) => {
    if (
      projectId === STUB_PROJECT_1.id ||
      projectId === STUB_PROJECT_2.id ||
      projectId === STUB_CREATED_PROJECT_ID
    ) {
      return Effect.void;
    }
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: projectId,
      }),
    );
  },

  // --- Project core (7B-4B Task 5) ---------------------------------------
  "projects.get": ({ id }: { id: string }) => {
    if (id === STUB_PROJECT_1.id) return Effect.succeed(STUB_PROJECT_1);
    if (id === STUB_PROJECT_2.id) return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: id,
      }),
    );
  },
  "projects.discovery": (_payload: { workspaceId: string }) =>
    Effect.succeed(STUB_DISCOVERY_RESULT),
  "projects.updateAutomationSettings": ({
    projectId,
  }: {
    projectId: string;
    settings: Record<string, unknown>;
  }) => {
    if (projectId === STUB_PROJECT_1.id)
      return Effect.succeed(STUB_PROJECT_1);
    if (projectId === STUB_PROJECT_2.id)
      return Effect.succeed(STUB_PROJECT_2);
    return Effect.fail(
      new ProjectNotFoundError({
        tenantId: STUB_TENANT_ID,
        identifier: projectId,
      }),
    );
  },
  "projects.dismissDir": ({ dirId }: { dirId: string }) => {
    if (dirId === "00000000-0000-0000-0000-000000000000") {
      return Effect.fail(
        new NotFoundError({ entity: "DiscoveredDir", id: dirId }),
      );
    }
    return Effect.succeed({ ok: true as const });
  },

  // --- Workspace (7B-4B Task 5) ------------------------------------------
  "projects.workspace.list": () =>
    Effect.succeed([STUB_WORKSPACE_MEMBER_1]),
  "projects.workspace.create": ({
    name,
    slug,
    description,
  }: {
    name: string;
    slug: string;
    description?: string;
  }) =>
    Effect.succeed({
      ...STUB_WORKSPACE_1,
      name,
      slug,
      description: description ?? null,
    } satisfies WorkspaceWire),
  "projects.workspace.rename": ({
    id,
    name,
  }: {
    id: string;
    name: string;
  }) => {
    if (id === STUB_WORKSPACE_1.id) {
      return Effect.succeed({ ...STUB_WORKSPACE_1, name } satisfies WorkspaceWire);
    }
    return Effect.fail(
      new NotFoundError({ entity: "Workspace", id }),
    );
  },
  "projects.workspace.delete": ({ id }: { id: string }) => {
    if (id === STUB_WORKSPACE_1.id) {
      return Effect.succeed({ deleted: true as const });
    }
    return Effect.fail(
      new NotFoundError({ entity: "Workspace", id }),
    );
  },

  // --- Repository (7B-4B Task 6) -------------------------------------------
  "projects.repository.list": () =>
    Effect.succeed([STUB_REPOSITORY_1]),
  "projects.repository.byId": ({ id }: { id: string }) => {
    if (id === STUB_REPOSITORY_1.id) return Effect.succeed(STUB_REPOSITORY_1);
    return Effect.fail(
      new NotFoundError({ entity: "Repository", id }),
    );
  },
  "projects.repository.add": ({
    repositoryPath,
  }: {
    repositoryPath: string;
  }) =>
    Effect.succeed({
      ...STUB_REPOSITORY_1,
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      name: repositoryPath.split("/").pop() ?? "unknown",
      path: repositoryPath,
      remoteUrl: null,
      remoteProvider: null,
      remoteOwner: null,
      remoteName: null,
    } satisfies RepositoryWire),
  "projects.repository.addFromProvider": ({
    fullName,
    cloneUrl,
    defaultBranch,
  }: {
    fullName: string;
    cloneUrl: string;
    htmlUrl: string;
    defaultBranch?: string;
    provider?: string;
    instanceUrl?: string;
    projectId?: string;
  }) => {
    const [owner, name] = fullName.split("/");
    const repoName = name ?? fullName;
    return Effect.succeed({
      ...STUB_REPOSITORY_1,
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      name: repoName,
      path: `/home/mackieg/repos/${repoName}`,
      branch: defaultBranch ?? "main",
      mainBranch: defaultBranch ?? "main",
      remoteUrl: cloneUrl,
      remoteOwner: owner ?? "",
      remoteName: repoName,
    } satisfies RepositoryWire);
  },
  "projects.repository.delete": ({ id }: { id: string }) => {
    void id;
    return Effect.succeed({ success: true as const });
  },
  "projects.repository.refreshMainBranch": ({ id }: { id: string }) => {
    if (id === STUB_REPOSITORY_1.id) return Effect.succeed(STUB_REPOSITORY_1);
    return Effect.fail(
      new NotFoundError({ entity: "Repository", id }),
    );
  },
  "projects.repository.getWorktrees": (_payload: {
    repositoryId: string;
  }) => Effect.succeed([STUB_WORKTREE_1]),
  "projects.repository.createWorktree": ({
    repositoryId,
    branchName,
  }: {
    repositoryId: string;
    branchName: string;
    baseBranch?: string;
    agentType?: string;
    planning?: {
      title?: string;
      goal?: string;
      planningTaskId?: string;
      tasks?: readonly {
        readonly key: string;
        readonly content: string;
        readonly status?: "pending" | "in_progress" | "completed" | "cancelled";
      }[];
    };
  }) => {
    if (repositoryId !== STUB_REPOSITORY_1.id) {
      return Effect.fail(
        new NotFoundError({ entity: "Repository", id: repositoryId }),
      );
    }
    return Effect.succeed({
      ...STUB_WORKTREE_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff0",
      branch: branchName,
      path: `/home/mackieg/.bob/acme-repo-${branchName}`,
    } satisfies WorktreeWire);
  },
  "projects.repository.getWorktreePlanning": ({
    worktreeId,
  }: {
    worktreeId: string;
  }) => {
    if (worktreeId !== STUB_WORKTREE_1.id) {
      return Effect.fail(
        new NotFoundError({ entity: "Worktree", id: worktreeId }),
      );
    }
    return Effect.succeed({
      exists: true,
      path: STUB_WORKTREE_PLAN_1.filePath,
      content: null,
      parsed: {
        frontmatter: {},
        title: STUB_WORKTREE_PLAN_1.title ?? undefined,
        goal: STUB_WORKTREE_PLAN_1.goal ?? undefined,
        tasks: [],
      },
      dbRecord: STUB_WORKTREE_PLAN_1,
    });
  },
  "projects.repository.updateWorktreePlanning": ({
    worktreeId,
  }: {
    worktreeId: string;
    content?: string;
    title?: string;
    goal?: string;
    status?: string;
    planningTaskId?: string | null;
    tasks?: readonly {
      readonly key: string;
      readonly content: string;
      readonly status?: "pending" | "in_progress" | "completed" | "cancelled";
    }[];
  }) => {
    if (worktreeId !== STUB_WORKTREE_1.id) {
      return Effect.fail(
        new NotFoundError({ entity: "Worktree", id: worktreeId }),
      );
    }
    return Effect.succeed({
      success: true as const,
      plan: STUB_WORKTREE_PLAN_1,
      path: STUB_WORKTREE_PLAN_1.filePath,
    });
  },
  "projects.repository.deleteWorktree": ({
    worktreeId,
  }: {
    worktreeId: string;
    force?: boolean;
  }) => {
    if (worktreeId !== STUB_WORKTREE_1.id) {
      return Effect.fail(
        new NotFoundError({ entity: "Worktree", id: worktreeId }),
      );
    }
    return Effect.succeed({ success: true as const });
  },
  "projects.repository.getWorktreeMergeStatus": ({
    worktreeId,
  }: {
    worktreeId: string;
  }) => {
    if (worktreeId !== STUB_WORKTREE_1.id) {
      return Effect.fail(
        new NotFoundError({ entity: "Worktree", id: worktreeId }),
      );
    }
    return Effect.succeed({
      merged: false as const,
      hasUncommittedChanges: false as const,
    });
  },

  // --- Pull request (7B-4B Task 7) -----------------------------------------
  "projects.pullRequest.list": (_payload: {
    status?: string;
    limit?: number;
  }) => Effect.succeed([STUB_PULL_REQUEST_1]),
  "projects.pullRequest.get": ({
    pullRequestId,
  }: {
    pullRequestId: string;
  }) => {
    if (pullRequestId === STUB_PULL_REQUEST_1.id)
      return Effect.succeed(STUB_PULL_REQUEST_1);
    return Effect.fail(
      new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
    );
  },
  "projects.pullRequest.listByRepository": (_payload: {
    repositoryId: string;
    status?: string;
    limit?: number;
    includeCommits?: boolean;
  }) => Effect.succeed([STUB_PULL_REQUEST_1]),
  "projects.pullRequest.listBySession": (_payload: {
    sessionId: string;
  }) => Effect.succeed([STUB_PULL_REQUEST_1]),
  "projects.pullRequest.create": ({
    repositoryId,
    title,
    headBranch,
    baseBranch,
    body,
    sessionId,
    draft,
    planningTaskId,
  }: {
    repositoryId: string;
    title: string;
    headBranch: string;
    baseBranch?: string;
    body?: string;
    sessionId?: string;
    draft?: boolean;
    planningTaskId?: string;
  }) =>
    Effect.succeed({
      ...STUB_PULL_REQUEST_1,
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      repositoryId,
      sessionId: sessionId ?? null,
      title,
      body: body ?? null,
      headBranch,
      baseBranch: baseBranch ?? "main",
      status: (draft ? "draft" : "open") as "draft" | "open",
      planningTaskId: planningTaskId ?? null,
      remoteNumber: null,
      remoteUrl: null,
    } satisfies PullRequestWire),
  "projects.pullRequest.update": ({
    pullRequestId,
    title,
    body,
    state,
  }: {
    pullRequestId: string;
    title?: string;
    body?: string;
    state?: "open" | "closed";
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed({
      ...STUB_PULL_REQUEST_1,
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(state === "closed" ? { status: "closed" as const } : {}),
    } satisfies PullRequestWire);
  },
  "projects.pullRequest.merge": ({
    pullRequestId,
  }: {
    pullRequestId: string;
    mergeMethod?: string;
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed({
      ...STUB_PULL_REQUEST_1,
      status: "merged" as const,
      mergedAt: "2026-04-21T14:00:00Z",
    } satisfies PullRequestWire);
  },
  "projects.pullRequest.syncCommits": ({
    pullRequestId,
  }: {
    pullRequestId: string;
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed(STUB_PULL_REQUEST_1);
  },
  "projects.pullRequest.linkToPlanningTask": (_payload: {
    pullRequestId: string;
    planningTaskId: string;
  }) => Effect.succeed({ success: true as const }),
  "projects.pullRequest.refresh": ({
    pullRequestId,
  }: {
    pullRequestId: string;
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed(STUB_PULL_REQUEST_1);
  },
  "projects.pullRequest.listReviews": ({
    pullRequestId,
  }: {
    pullRequestId: string;
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed([STUB_PR_REVIEW_1]);
  },
  "projects.pullRequest.addReview": ({
    pullRequestId,
    status,
    body,
  }: {
    pullRequestId: string;
    status: "approved" | "changes_requested" | "commented";
    body?: string;
  }) => {
    if (pullRequestId !== STUB_PULL_REQUEST_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "PullRequest", id: pullRequestId }),
      );
    return Effect.succeed({
      ...STUB_PR_REVIEW_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff1",
      status,
      body: body ?? null,
    } satisfies PRReviewWire);
  },

  // --- Feature branch (7B-4B Task 7) ----------------------------------------
  "projects.featureBranch.create": ({
    workItemId,
    repositoryId,
    branchName,
    baseBranch,
  }: {
    workItemId: string;
    repositoryId: string;
    branchName: string;
    baseBranch?: string;
  }) =>
    Effect.succeed({
      ...STUB_FEATURE_BRANCH_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff2",
      workItemId,
      repositoryId,
      branchName,
      baseBranch: baseBranch ?? "main",
    } satisfies FeatureBranchWire),
  "projects.featureBranch.get": ({ id }: { id: string }) => {
    if (id !== STUB_FEATURE_BRANCH_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "FeatureBranch", id }),
      );
    return Effect.succeed({
      ...STUB_FEATURE_BRANCH_1,
      taskPRs: [STUB_FEATURE_BRANCH_TASK_PR_1],
    } satisfies FeatureBranchDetailWire);
  },
  "projects.featureBranch.list": (_payload: { workItemId: string }) =>
    Effect.succeed([
      {
        id: STUB_FEATURE_BRANCH_1.id,
        workItemId: STUB_FEATURE_BRANCH_1.workItemId,
        repositoryId: STUB_FEATURE_BRANCH_1.repositoryId,
        branchName: STUB_FEATURE_BRANCH_1.branchName,
        baseBranch: STUB_FEATURE_BRANCH_1.baseBranch,
        status: STUB_FEATURE_BRANCH_1.status,
        featurePrId: STUB_FEATURE_BRANCH_1.featurePrId,
        createdAt: STUB_FEATURE_BRANCH_1.createdAt,
        taskPRCount: 1,
      } satisfies FeatureBranchListItemWire,
    ]),
  "projects.featureBranch.addTaskPR": ({
    featureBranchId,
    pullRequestId,
  }: {
    featureBranchId: string;
    pullRequestId: string;
  }) => {
    if (featureBranchId !== STUB_FEATURE_BRANCH_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "FeatureBranch", id: featureBranchId }),
      );
    return Effect.succeed({
      ...STUB_FEATURE_BRANCH_TASK_PR_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff3",
      pullRequestId,
    } satisfies FeatureBranchTaskPRWire);
  },
  "projects.featureBranch.markTaskPRMerged": ({
    featureBranchId,
  }: {
    featureBranchId: string;
    pullRequestId: string;
  }) => {
    if (featureBranchId !== STUB_FEATURE_BRANCH_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "FeatureBranch", id: featureBranchId }),
      );
    return Effect.succeed({
      ...STUB_FEATURE_BRANCH_TASK_PR_1,
      mergedAt: "2026-04-21T14:00:00Z",
    } satisfies FeatureBranchTaskPRWire);
  },
  "projects.featureBranch.createFeaturePR": ({
    featureBranchId,
    title,
    repositoryId,
  }: {
    featureBranchId: string;
    title: string;
    repositoryId: string;
  }) => {
    if (featureBranchId !== STUB_FEATURE_BRANCH_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "FeatureBranch", id: featureBranchId }),
      );
    const pr: PullRequestWire = {
      ...STUB_PULL_REQUEST_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff4",
      repositoryId,
      title,
      headBranch: STUB_FEATURE_BRANCH_1.branchName,
      baseBranch: STUB_FEATURE_BRANCH_1.baseBranch,
      status: "open",
    };
    return Effect.succeed({
      featureBranch: {
        ...STUB_FEATURE_BRANCH_1,
        featurePrId: pr.id,
      } satisfies FeatureBranchWire,
      pullRequest: pr,
    });
  },
  "projects.featureBranch.updateStatus": ({
    id,
    status,
  }: {
    id: string;
    status: "active" | "ready" | "merged" | "abandoned";
  }) => {
    if (id !== STUB_FEATURE_BRANCH_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "FeatureBranch", id }),
      );
    return Effect.succeed({
      ...STUB_FEATURE_BRANCH_1,
      status,
    } satisfies FeatureBranchWire);
  },

  // --- Git provider (7B-4B Task 8) -------------------------------------------
  "projects.gitProvider.listConnections": () =>
    Effect.succeed([STUB_GIT_PROVIDER_CONNECTION_1]),
  "projects.gitProvider.connectPat": ({
    provider,
    instanceUrl,
  }: {
    provider: "github" | "gitlab" | "gitea";
    accessToken: string;
    instanceUrl?: string;
  }) =>
    Effect.succeed({
      ...STUB_GIT_PROVIDER_CONNECTION_1,
      id: "ffffffff-ffff-ffff-ffff-fffffffffff5",
      provider,
      instanceUrl: instanceUrl ?? null,
    } satisfies GitProviderConnectionWire),
  "projects.gitProvider.disconnect": ({
    connectionId,
  }: {
    connectionId: string;
  }) => {
    if (connectionId !== STUB_GIT_PROVIDER_CONNECTION_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "GitProviderConnection", id: connectionId }),
      );
    return Effect.succeed({ success: true as const });
  },
  "projects.gitProvider.testConnection": (_payload: {
    connectionId?: string;
    provider?: "github" | "gitlab" | "gitea";
    instanceUrl?: string;
  }) =>
    Effect.succeed({
      valid: true,
      user: {
        id: STUB_GIT_PROVIDER_CONNECTION_1.providerAccountId,
        username: STUB_GIT_PROVIDER_CONNECTION_1.providerUsername,
        name: "Acme Developer" as string | null,
        avatarUrl: null as string | null,
      },
    } satisfies ConnectionTestResultWire),
  "projects.gitProvider.setDefaultForRepo": ({
    repositoryId,
    connectionId,
  }: {
    repositoryId: string;
    connectionId: string;
  }) => {
    if (connectionId !== STUB_GIT_PROVIDER_CONNECTION_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "GitProviderConnection", id: connectionId }),
      );
    if (repositoryId !== STUB_REPOSITORY_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "Repository", id: repositoryId }),
      );
    return Effect.succeed({ success: true as const });
  },
  "projects.gitProvider.detectRemote": ({
    repositoryId,
  }: {
    repositoryId: string;
  }) => {
    if (repositoryId !== STUB_REPOSITORY_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "Repository", id: repositoryId }),
      );
    return Effect.succeed({
      detected: true,
      remoteUrl: STUB_REPOSITORY_1.remoteUrl!,
      provider: "github" as const,
      instanceUrl: null,
      owner: STUB_REPOSITORY_1.remoteOwner,
      name: STUB_REPOSITORY_1.remoteName,
    } satisfies RemoteDetectionResultWire);
  },

  // --- Git (7B-4B Task 8) ----------------------------------------------------
  "projects.git.pushAndCreatePr": ({
    repositoryId,
    title,
    headBranch,
    baseBranch,
    body,
    sessionId,
    draft,
    planningTaskId,
  }: {
    repositoryId: string;
    path: string;
    sessionId?: string;
    title: string;
    body?: string;
    headBranch: string;
    baseBranch?: string;
    draft?: boolean;
    planningTaskId?: string;
  }) => {
    if (repositoryId !== STUB_REPOSITORY_1.id)
      return Effect.fail(
        new NotFoundError({ entity: "Repository", id: repositoryId }),
      );
    return Effect.succeed({
      pushed: true,
      pullRequest: {
        ...STUB_PULL_REQUEST_1,
        id: "ffffffff-ffff-ffff-ffff-fffffffffff6",
        repositoryId,
        sessionId: sessionId ?? null,
        title,
        body: body ?? null,
        headBranch,
        baseBranch: baseBranch ?? "main",
        status: (draft ? "draft" : "open") as "draft" | "open",
        planningTaskId: planningTaskId ?? null,
      },
    } satisfies PushAndCreatePrResultWire);
  },
  "projects.git.jjIsRepo": (_payload: { path: string }) =>
    Effect.succeed(true),
  "projects.git.jjLog": (_payload: { path: string; limit?: number }) =>
    Effect.succeed([STUB_JJ_COMMIT_1]),
  "projects.git.jjNew": (_payload: { path: string; description?: string }) =>
    Effect.succeed({ success: true as const } satisfies JjMutationResultWire),
  "projects.git.jjDescribe": (_payload: {
    path: string;
    description: string;
    revision?: string;
  }) =>
    Effect.succeed({ success: true as const } satisfies JjMutationResultWire),
  "projects.git.jjSquash": (_payload: { path: string }) =>
    Effect.succeed({ success: true as const } satisfies JjMutationResultWire),
  "projects.git.jjDiff": (_payload: { path: string; revision?: string }) =>
    Effect.succeed({
      diff: "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n",
    } satisfies JjDiffResultWire),
} as const;

/** Layer form — pass to `RpcServer.layerHttp({ group, handlers })`. */
export const stubProjectsHandlersLayer = ProjectsRpc.toLayer(
  stubProjectsHandlers,
);
