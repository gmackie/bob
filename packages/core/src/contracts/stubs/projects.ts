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
import { Effect } from "effect";

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

export const STUB_TENANT_ID = "00000000-0000-0000-0000-000000000001";

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
  createdAt: "2026-04-21T12:00:00Z",
  updatedAt: "2026-04-21T12:00:00Z",
};

export const STUB_WORKSPACE_MEMBER_1: WorkspaceMemberWire = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  workspaceId: STUB_WORKSPACE_1.id,
  userId: "00000000-0000-0000-0000-000000000099",
  role: "owner",
  joinedAt: "2026-04-21T12:00:00Z",
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
      tasks?: Array<{ key: string; content: string; status?: string }>;
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
    tasks?: Array<{ key: string; content: string; status?: string }>;
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
} as const;

/** Layer form — pass to `RpcServer.layerHttp({ group, handlers })`. */
export const stubProjectsHandlersLayer = ProjectsRpc.toLayer(
  stubProjectsHandlers,
);
