import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  workspaceMembersFindMany: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
  projectsFindMany: vi.fn(),
  projectsFindFirst: vi.fn(),
  repositoriesFindMany: vi.fn(),
  workItemsFindMany: vi.fn(),
  workItemsFindFirst: vi.fn(),
  workItemArtifactsFindMany: vi.fn(),
  chatConversationsFindMany: vi.fn(),
  chatConversationsFindFirst: vi.fn(),
  commentsFindMany: vi.fn(),
  notificationsFindMany: vi.fn(),
  taskRunsFindMany: vi.fn(),
};

const insertReturning = vi.fn();
const updateReturning = vi.fn();

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
    chatConversations: {
      findMany: queryMocks.chatConversationsFindMany,
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    comments: {
      findMany: queryMocks.commentsFindMany,
    },
    notifications: {
      findMany: queryMocks.notificationsFindMany,
    },
    taskRuns: {
      findMany: queryMocks.taskRunsFindMany,
    },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      returning: insertReturning,
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: updateReturning,
      })),
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
    apiKeyAuth: null,
    db: makeDbMock() as any,
  });

describe("product-facing app router", () => {
  const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const taskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const notificationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
    insertReturning.mockReset();
    updateReturning.mockReset();
  });

  it("exposes the unified planning and collaboration subrouters", async () => {
    expect((appRouter as any)._def.record.planning).toBeDefined();
    expect((appRouter as any)._def.record.kanbanger).toBeUndefined();

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
    queryMocks.workspaceMembersFindFirst.mockResolvedValue({
      id: "membership-1",
    });
    queryMocks.projectsFindMany.mockResolvedValue([
      {
        id: projectId,
        workspaceId,
        name: "Merge",
        key: "MERGE",
        status: "in_progress",
      },
    ]);
    queryMocks.workItemsFindMany.mockResolvedValue([
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
    queryMocks.repositoriesFindMany.mockResolvedValue([]);
    queryMocks.chatConversationsFindMany.mockResolvedValue([]);
    queryMocks.taskRunsFindMany.mockResolvedValue([
      {
        id: taskId,
        userId: "user-1",
        sessionId: "session-1",
        workItemId: taskId,
        workItemIdentifierSnapshot: "MERGE-12",
        planningItemId: taskId,
        planningItemIdentifier: "MERGE-12",
        status: "running",
        createdAt: new Date("2026-03-11T11:00:00.000Z"),
        updatedAt: new Date("2026-03-11T11:05:00.000Z"),
      },
    ]);
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId,
      name: "Merge",
      key: "MERGE",
    });
    queryMocks.workItemsFindFirst.mockResolvedValue({
      id: taskId,
      workspaceId,
      projectId,
      sequenceNumber: 12,
      kind: "task",
      title: "Port planning shell",
      status: "in_progress",
      parentId: null,
    });
    queryMocks.workItemArtifactsFindMany.mockResolvedValueOnce([
      {
        id: "artifact-1",
        workItemId: taskId,
        artifactRole: "verification",
        isCurrent: true,
        createdAt: new Date("2026-03-11T11:06:00.000Z"),
      },
    ]);
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce(null);
    queryMocks.commentsFindMany.mockResolvedValueOnce([
      {
        id: "comment-1",
        workItemId: taskId,
        body: "Please keep mobile focused on the task scope.",
        createdAt: new Date("2026-03-11T11:07:00.000Z"),
      },
    ]);
    queryMocks.notificationsFindMany.mockResolvedValueOnce([
      {
        id: notificationId,
        userId: "user-1",
        type: "review_ready",
        title: "Review ready",
        body: "MERGE-12 is ready for review",
        read: false,
        archivedAt: null,
        createdAt: new Date("2026-03-11T11:08:00.000Z"),
      },
    ]);
    updateReturning.mockResolvedValueOnce([
      {
        id: notificationId,
        read: true,
      },
    ]);

    const caller = createCaller() as any;

    expect(typeof caller.planning.listWorkspaces).toBe("function");

    const workspaces = await caller.workspace.list();
    const projects = await caller.project.list({ workspaceId });
    const workItems = await caller.workItem.list({ workspaceId, limit: 20 });
    queryMocks.workItemsFindMany.mockResolvedValueOnce([
      { id: "child-1" },
      { id: "child-2" },
    ]);
    const detail = await caller.workItem.get({ id: taskId });
    const comments = await caller.comment.listByWorkItem({ workItemId: taskId });
    const notifications = await caller.notification.list({ limit: 20 });
    const taskRuns = await caller.taskRun.listByWorkItem({ workItemId: taskId });

    await caller.notification.markAsRead({ id: notificationId });

    expect(workspaces[0]?.workspace.id).toBe(workspaceId);
    expect(projects[0]?.project.id).toBe(projectId);
    expect(workItems[0]?.identifier).toBe("MERGE-12");
    expect(detail.workItem.identifier).toBe("MERGE-12");
    expect(comments[0]?.body).toContain("mobile focused");
    expect(notifications.items[0]?.title).toBe("Review ready");
    expect(taskRuns[0]).toEqual(
      expect.objectContaining({
        workItemId: taskId,
        workItemIdentifier: "MERGE-12",
        sessionId: "session-1",
        status: "running",
      }),
    );
  });
});
