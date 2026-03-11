import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let appRouter: typeof import("../../root").appRouter;

const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

const findManyMocks = {
  workItems: vi.fn(),
  workItemArtifacts: vi.fn(),
  notifications: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    workItems: {
      findMany: findManyMocks.workItems,
    },
    workItemArtifacts: {
      findMany: findManyMocks.workItemArtifacts,
    },
    notifications: {
      findMany: findManyMocks.notifications,
    },
  },
  insert: vi.fn(() => ({
    values: insertValuesMock.mockImplementation(() => ({
      returning: insertReturningMock,
    })),
  })),
  update: vi.fn(() => ({
    set: updateSetMock.mockImplementation(() => ({
      where: updateWhereMock.mockImplementation(() => ({
        returning: updateReturningMock,
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
    apiKeyAuth: null as any,
    db: makeDbMock() as any,
  });

describe("workItems router", () => {
  const workItemId = "11111111-1111-4111-8111-111111111111";
  const taskRunId = "22222222-2222-4222-8222-222222222222";
  const parentWorkItemId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    insertValuesMock.mockReset();
    insertReturningMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    updateReturningMock.mockReset();
    findManyMocks.workItems.mockReset();
    findManyMocks.workItemArtifacts.mockReset();
    findManyMocks.notifications.mockReset();
  });

  it("creates comments against work items and records activity", async () => {
    insertReturningMock
      .mockResolvedValueOnce([
        {
          id: "comment-1",
          workItemId,
          userId: "user-1",
          body: "Need to split this task",
        },
      ])
      .mockResolvedValueOnce([{ id: "activity-1" }]);

    const caller = createCaller() as any;

    const result = await caller.workItems.createComment({
      workItemId,
      body: "Need to split this task",
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId,
        userId: "user-1",
        body: "Need to split this task",
      }),
    );
    expect(result).toMatchObject({
      id: "comment-1",
      workItemId,
      body: "Need to split this task",
    });
  });

  it("replaces the current artifact for a role and keeps history", async () => {
    findManyMocks.workItemArtifacts.mockResolvedValueOnce([
      {
        id: "artifact-old",
        workItemId,
        artifactRole: "review",
        isCurrent: true,
      },
    ]);
    updateReturningMock.mockResolvedValueOnce([{ id: "artifact-old" }]);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "artifact-new",
        workItemId,
        artifactRole: "review",
        isCurrent: true,
      },
    ]);

    const caller = createCaller() as any;

    const result = await caller.workItems.createArtifact({
      workItemId,
      taskRunId,
      producerType: "bob",
      artifactType: "pr",
      artifactRole: "review",
      url: "https://example.com/pr/123",
      title: "Review PR",
    });

    expect(updateSetMock).toHaveBeenCalledWith({ isCurrent: false });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId,
        taskRunId,
        artifactRole: "review",
        isCurrent: true,
      }),
    );
    expect(result).toMatchObject({
      id: "artifact-new",
      artifactRole: "review",
      isCurrent: true,
    });
  });

  it("rolls up the latest child artifacts by child work item", async () => {
    findManyMocks.workItems.mockResolvedValueOnce([
      {
        id: "child-1",
        parentId: parentWorkItemId,
        title: "Child one",
        kind: "task",
        status: "in_progress",
      },
      {
        id: "child-2",
        parentId: parentWorkItemId,
        title: "Child two",
        kind: "task",
        status: "blocked",
      },
    ]);
    findManyMocks.workItemArtifacts
      .mockResolvedValueOnce([
        {
          id: "artifact-1",
          workItemId: "child-1",
          artifactRole: "review",
          isCurrent: true,
        },
      ])
      .mockResolvedValueOnce([]);

    const caller = createCaller() as any;

    const result = await caller.workItems.listChildArtifactGroups({
      parentWorkItemId,
    });

    expect(result).toEqual([
      {
        workItem: expect.objectContaining({
          id: "child-1",
          title: "Child one",
        }),
        artifacts: [
          expect.objectContaining({
            id: "artifact-1",
            workItemId: "child-1",
          }),
        ],
      },
    ]);
  });

  it("lists notifications linked to work items for the current user", async () => {
    findManyMocks.notifications.mockResolvedValueOnce([
      {
        id: "notification-1",
        userId: "user-1",
        workItemId,
        type: "work_item_needs_input",
        title: "Input needed",
        read: false,
      },
    ]);

    const caller = createCaller() as any;

    const result = await caller.workItems.listNotifications({
      unreadOnly: false,
      limit: 20,
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: "notification-1",
          workItemId,
          type: "work_item_needs_input",
        }),
      ],
    });
  });
});
