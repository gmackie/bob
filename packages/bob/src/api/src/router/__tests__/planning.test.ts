import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

let appRouter: typeof import("../../root").appRouter;

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/update surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const queryMocks = {
  workspaceMembersFindMany: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
  projectsFindMany: vi.fn(),
  projectsFindFirst: vi.fn(),
  repositoriesFindMany: vi.fn(),
  workItemsFindMany: vi.fn(),
  workItemsFindFirst: vi.fn(),
  workItemArtifactsFindMany: vi.fn(),
  workItemDependenciesFindMany: vi.fn(),
  chatConversationsFindMany: vi.fn(),
  chatConversationsFindFirst: vi.fn(),
  commentsFindMany: vi.fn(),
};

const selectMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

const makeDbMock = () => ({
  query: {
    workspaceMembers: {
      findMany: queryMocks.workspaceMembersFindMany,
      findFirst: queryMocks.workspaceMembersFindFirst,
    },
    projects: {
      findMany: queryMocks.projectsFindMany,
      findFirst: queryMocks.projectsFindFirst,
    },
    repositories: {
      findMany: queryMocks.repositoriesFindMany,
    },
    workItems: {
      findMany: queryMocks.workItemsFindMany,
      findFirst: queryMocks.workItemsFindFirst,
    },
    workItemArtifacts: {
      findMany: queryMocks.workItemArtifactsFindMany,
    },
    workItemDependencies: {
      findMany: queryMocks.workItemDependenciesFindMany,
    },
    chatConversations: {
      findMany: queryMocks.chatConversationsFindMany,
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    comments: {
      findMany: queryMocks.commentsFindMany,
    },
  },
  select: selectMock,
  insert: vi.fn(() => ({
    values: insertValuesMock.mockReturnValue({
      returning: insertReturningMock,
    }),
  })),
  update: vi.fn(() => ({
    set: updateSetMock.mockReturnValue({
      where: updateWhereMock.mockReturnValue({
        returning: updateReturningMock,
      }),
    }),
  })),
});

const createCaller = () =>
  appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: "user-1",
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: "user-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        email: "test@example.com",
        emailVerified: true,
        name: "Test User",
      },
    },
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

describe("planning routers", () => {
  const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const taskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
    [
      selectMock,
      insertValuesMock,
      insertReturningMock,
      updateSetMock,
      updateWhereMock,
      updateReturningMock,
    ].forEach((mock) => mock.mockReset());
  });

  it("lists workspaces for the current member", async () => {
    queryMocks.workspaceMembersFindMany.mockResolvedValueOnce([
      {
        role: "owner",
        joinedAt: new Date("2026-03-10T00:00:00.000Z"),
        workspace: {
          id: workspaceId,
          name: "Builder",
          slug: "builder",
        },
      },
    ]);

    const caller = createCaller();
    const result = await caller.workspace.list();

    expect(result).toEqual([
      expect.objectContaining({
        role: "owner",
        // vitest's `expect.objectContaining` return type is unconditionally
        // `any` (see @vitest/expect's type declarations), so nesting one
        // inside another object literal always trips no-unsafe-assignment
        // here — the matcher itself, not this test's own typing, is the gap.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        workspace: expect.objectContaining({
          id: workspaceId,
          slug: "builder",
        }),
      }),
    ]);
  });

  it("lists projects with derived work item counts", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    queryMocks.projectsFindMany.mockResolvedValueOnce([
      {
        id: projectId,
        workspaceId,
        name: "Merge",
        key: "MERGE",
        status: "in_progress",
        color: "#2255cc",
      },
    ]);
    queryMocks.workItemsFindMany.mockResolvedValueOnce([
      { id: "1", projectId, kind: "issue", status: "todo" },
      { id: "2", projectId, kind: "task", status: "in_progress" },
      { id: "3", projectId, kind: "epic", status: "draft" },
    ]);
    queryMocks.repositoriesFindMany.mockResolvedValueOnce([]);

    const caller = createCaller();
    const result = await caller.project.list({ workspaceId });

    expect(result).toEqual([
      expect.objectContaining({
        // Nested expect.objectContaining always returns `any` per vitest's
        // own type declarations — see the comment above in the previous test.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        project: expect.objectContaining({
          id: projectId,
          key: "MERGE",
        }),
        counts: {
          issues: 1,
          tasks: 1,
          epics: 1,
          active: 1,
        },
      }),
    ]);
  });

  it("lists work items with derived identifiers", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    queryMocks.workItemsFindMany.mockResolvedValueOnce([
      {
        id: taskId,
        workspaceId,
        projectId,
        sequenceNumber: 12,
        kind: "task",
        title: "Port planning shell",
        status: "in_progress",
        updatedAt: new Date("2026-03-11T10:00:00.000Z"),
      },
    ]);
    queryMocks.projectsFindMany.mockResolvedValueOnce([
      {
        id: projectId,
        workspaceId,
        name: "Merge",
        key: "MERGE",
        color: "#2255cc",
      },
    ]);
    queryMocks.chatConversationsFindMany.mockResolvedValueOnce([]);

    const caller = createCaller();
    const result = await caller.workItems.list({ workspaceId, limit: 20 });

    expect(result).toEqual([
      expect.objectContaining({
        id: taskId,
        identifier: "MERGE-12",
        kind: "task",
        // Nested expect.objectContaining always returns `any` per vitest's
        // own type declarations — see the comment earlier in this file.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        project: expect.objectContaining({
          id: projectId,
          key: "MERGE",
        }),
      }),
    ]);
  });

  it("rejects work item listing when the caller is not a member of the workspace", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);
    queryMocks.workItemsFindMany.mockResolvedValueOnce([]);

    const caller = createCaller();

    await expect(
      caller.workItems.list({ workspaceId, limit: 20 }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("gets a work item with current artifacts and child count", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: taskId,
      workspaceId,
      projectId,
      sequenceNumber: 12,
      kind: "task",
      title: "Port planning shell",
      status: "in_progress",
      parentId: null,
    });
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId,
      name: "Merge",
      key: "MERGE",
      color: "#2255cc",
    });
    queryMocks.workItemArtifactsFindMany.mockResolvedValueOnce([
      {
        id: "artifact-1",
        workItemId: taskId,
        artifactRole: "review",
        isCurrent: true,
      },
    ]);
    queryMocks.workItemsFindMany.mockResolvedValueOnce([
      { id: "child-1" },
      { id: "child-2" },
    ]);
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce(null);
    queryMocks.workItemDependenciesFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const caller = createCaller();
    const result = await caller.workItems.get({ id: taskId });

    expect(result).toMatchObject({
      // expect.objectContaining's return type is unconditionally `any` per
      // vitest's own type declarations — see the comment earlier in this file.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      workItem: expect.objectContaining({
        id: taskId,
        identifier: "MERGE-12",
      }),
      currentArtifacts: [
        expect.objectContaining({
          id: "artifact-1",
        }),
      ],
      childCount: 2,
    });
  });

  it("rejects work item detail when the caller is not a member of the workspace", async () => {
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: taskId,
      workspaceId,
      projectId,
      sequenceNumber: 12,
      kind: "task",
      title: "Port planning shell",
      status: "in_progress",
      parentId: null,
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(caller.workItems.get({ id: taskId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  describe("planning router auth", () => {
    it("lists planning workspaces from caller memberships", async () => {
      queryMocks.workspaceMembersFindMany.mockResolvedValueOnce([
        {
          workspace: {
            id: workspaceId,
            name: "Builder",
            slug: "builder",
          },
        },
      ]);

      const caller = createCaller();
      const result = await caller.planning.listWorkspaces();

      expect(result).toEqual([
        {
          id: workspaceId,
          name: "Builder",
          slug: "builder",
        },
      ]);
    });

    it("rejects planning project listing when the caller is not a member of the workspace", async () => {
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.listProjects({ workspaceId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning project detail when the caller is not a member of the project workspace", async () => {
      queryMocks.projectsFindFirst.mockResolvedValueOnce({
        id: projectId,
        workspaceId,
        name: "Merge",
        key: "MERGE",
        status: "in_progress",
        color: "#2255cc",
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.getProject({ id: projectId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning task lookup by identifier when the caller is not a member of the project workspace", async () => {
      queryMocks.projectsFindFirst.mockResolvedValueOnce({
        id: projectId,
        workspaceId,
        key: "MERGE",
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.getTaskByIdentifier({ identifier: "MERGE-12" }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning task creation when the caller is not a member of the project workspace", async () => {
      queryMocks.projectsFindFirst.mockResolvedValueOnce({
        id: projectId,
        workspaceId,
        key: "MERGE",
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.createTask({
          projectId,
          title: "Ship planning hardening",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning task updates when the caller is not a member of the task workspace", async () => {
      queryMocks.workItemsFindFirst.mockResolvedValueOnce({
        id: taskId,
        workspaceId,
        projectId,
        sequenceNumber: 12,
        title: "Ship planning hardening",
        status: "todo",
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.updateTask({
          id: taskId,
          status: "done",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning comment creation when the caller is not a member of the task workspace", async () => {
      queryMocks.workItemsFindFirst.mockResolvedValueOnce({
        id: taskId,
        workspaceId,
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.addComment({
          issueId: taskId,
          body: "Private note",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning comment listing when the caller is not a member of the task workspace", async () => {
      queryMocks.workItemsFindFirst.mockResolvedValueOnce({
        id: taskId,
        workspaceId,
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.listComments({
          issueId: taskId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning task search when the caller is not a member of the workspace", async () => {
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.searchTasks({
          workspaceId,
          query: "planning",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects planning label listing when the caller is not a member of the workspace", async () => {
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.listLabels({
          workspaceId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects agent task claims when the caller is not a member of the task workspace", async () => {
      queryMocks.workItemsFindFirst.mockResolvedValueOnce({
        id: taskId,
        workspaceId,
      });
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.agentClaimTask({
          agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          issueId: taskId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("rejects agent session starts when the caller is not a member of the workspace", async () => {
      queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

      const caller = createCaller();

      await expect(
        caller.planning.agentStartSession({
          agentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          workspaceId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
