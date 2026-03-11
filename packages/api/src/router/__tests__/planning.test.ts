import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  workspaceMembersFindMany: vi.fn(),
  projectsFindMany: vi.fn(),
  projectsFindFirst: vi.fn(),
  workItemsFindMany: vi.fn(),
  workItemsFindFirst: vi.fn(),
  workItemArtifactsFindMany: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    workspaceMembers: {
      findMany: queryMocks.workspaceMembersFindMany,
    },
    projects: {
      findMany: queryMocks.projectsFindMany,
      findFirst: queryMocks.projectsFindFirst,
    },
    workItems: {
      findMany: queryMocks.workItemsFindMany,
      findFirst: queryMocks.workItemsFindFirst,
    },
    workItemArtifacts: {
      findMany: queryMocks.workItemArtifactsFindMany,
    },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(),
    })),
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
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null as any,
    db: makeDbMock() as any,
  });

describe("planning routers", () => {
  const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const taskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
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

    const caller = createCaller() as any;
    const result = await caller.workspace.list();

    expect(result).toEqual([
      expect.objectContaining({
        role: "owner",
        workspace: expect.objectContaining({
          id: workspaceId,
          slug: "builder",
        }),
      }),
    ]);
  });

  it("lists projects with derived work item counts", async () => {
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

    const caller = createCaller() as any;
    const result = await caller.project.list({ workspaceId });

    expect(result).toEqual([
      expect.objectContaining({
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

    const caller = createCaller() as any;
    const result = await caller.workItems.list({ workspaceId, limit: 20 });

    expect(result).toEqual([
      expect.objectContaining({
        id: taskId,
        identifier: "MERGE-12",
        kind: "task",
        project: expect.objectContaining({
          id: projectId,
          key: "MERGE",
        }),
      }),
    ]);
  });

  it("gets a work item with current artifacts and child count", async () => {
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

    const caller = createCaller() as any;
    const result = await caller.workItems.get({ id: taskId });

    expect(result).toMatchObject({
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
});
