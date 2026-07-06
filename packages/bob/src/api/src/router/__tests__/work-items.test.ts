import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

let appRouter: typeof import("../../root").appRouter;

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/update surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

const findManyMocks = {
  workItems: vi.fn(),
  workItemArtifacts: vi.fn(),
  comments: vi.fn(),
  activities: vi.fn(),
  notifications: vi.fn(),
  taskRuns: vi.fn(),
};

const findFirstMocks = {
  workItems: vi.fn(),
  workspaceMembers: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    workItems: {
      findMany: findManyMocks.workItems,
      findFirst: findFirstMocks.workItems,
    },
    workspaceMembers: {
      findFirst: findFirstMocks.workspaceMembers,
    },
    workItemArtifacts: {
      findMany: findManyMocks.workItemArtifacts,
    },
    comments: {
      findMany: findManyMocks.comments,
    },
    activities: {
      findMany: findManyMocks.activities,
    },
    notifications: {
      findMany: findManyMocks.notifications,
    },
    taskRuns: {
      findMany: findManyMocks.taskRuns,
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
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

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
    findFirstMocks.workItems.mockReset();
    findFirstMocks.workspaceMembers.mockReset();
    findManyMocks.workItemArtifacts.mockReset();
    findManyMocks.comments.mockReset();
    findManyMocks.activities.mockReset();
    findManyMocks.notifications.mockReset();
    findManyMocks.taskRuns.mockReset();
  });

  it("creates comments against work items and records activity", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce({
      id: "membership-1",
    });
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

    const caller = createCaller();

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

  it("persists workspace queue order for work items", async () => {
    const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const firstWorkItemId = "11111111-1111-4111-8111-111111111111";
    const secondWorkItemId = "22222222-2222-4222-8222-222222222222";

    findFirstMocks.workspaceMembers.mockResolvedValueOnce({
      id: "membership-1",
    });

    const caller = createCaller();

    await expect(
      caller.workItems.reorderQueue({
        workspaceId,
        workItemIds: [secondWorkItemId, firstWorkItemId],
      }),
    ).resolves.toEqual({ success: true });

    expect(updateSetMock).toHaveBeenNthCalledWith(1, { queueSortOrder: 0 });
    expect(updateSetMock).toHaveBeenNthCalledWith(2, { queueSortOrder: 1 });
  });

  it("rejects comment creation when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "comment-1",
        workItemId,
        userId: "user-1",
        body: "Need to split this task",
      },
    ]);

    const caller = createCaller();

    await expect(
      caller.workItems.createComment({
        workItemId,
        body: "Need to split this task",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("replaces the current artifact for a role and keeps history", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce({
      id: "membership-1",
    });
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

    const caller = createCaller();

    const result = await caller.workItems.createArtifact({
      workItemId,
      taskRunId,
      // createArtifactInputSchema constrains producerType to
      // "task_run"|"session"|"integration"|"manual". Test was originally
      // sending "bob" — likely from a pre-rename schema. Using "task_run"
      // since the request also carries taskRunId.
      producerType: "task_run",
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

  it("rejects artifact creation when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);
    findManyMocks.workItemArtifacts.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "artifact-new",
        workItemId,
        artifactRole: "review",
        isCurrent: true,
      },
    ]);

    const caller = createCaller();

    await expect(
      caller.workItems.createArtifact({
        workItemId,
        taskRunId,
        // Same producerType fix as the sibling test — "bob" is rejected
        // by Zod before the auth check fires, so we use a valid value
        // ("task_run") to exercise the workspace-membership rejection path.
        producerType: "task_run",
        artifactType: "pr",
        artifactRole: "review",
        url: "https://example.com/pr/123",
        title: "Review PR",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rolls up the latest child artifacts by child work item", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: parentWorkItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce({
      id: "membership-1",
    });
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

    const caller = createCaller();

    const result = await caller.workItems.listChildArtifactGroups({
      parentWorkItemId,
    });

    expect(result).toEqual([
      {
        // vitest's expect.objectContaining always returns `any` per its own
        // type declarations, regardless of generic — nesting it as an
        // object-literal property value trips no-unsafe-assignment here.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

  it("rejects comment listing when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.workItems.listComments({
        workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects activity listing when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.workItems.listActivities({
        workItemId,
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects current artifact listing when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.workItems.listCurrentArtifacts({
        workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects child artifact grouping when the caller is not a member of the parent work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: parentWorkItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.workItems.listChildArtifactGroups({
        parentWorkItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
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

    const caller = createCaller();

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

  it("rejects task run listing when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.taskRun.listByWorkItem({
        workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects task execution when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.taskRun.execute({
        workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("promotes an issue into a task while preserving its parent linkage", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parentId: parentWorkItemId,
      projectId: "44444444-4444-4444-8444-444444444444",
      sequenceNumber: 17,
      kind: "issue",
      title: "Investigate flaky deploy preview",
      status: "draft",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce({
      id: "membership-1",
    });
    updateReturningMock.mockResolvedValueOnce([
      {
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        parentId: parentWorkItemId,
        projectId: "44444444-4444-4444-8444-444444444444",
        sequenceNumber: 17,
        kind: "task",
        title: "Investigate flaky deploy preview",
        status: "draft",
      },
    ]);
    insertReturningMock.mockResolvedValueOnce([{ id: "activity-1" }]);

    const caller = createCaller();

    const result = await caller.workItems.promoteToTask({
      id: workItemId,
    });

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "task",
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId,
        userId: "user-1",
        type: "status_changed",
        fromValue: "issue",
        toValue: "task",
        // Nested expect.objectContaining always returns `any` — see comment
        // earlier in this file.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          field: "kind",
        }),
      }),
    );
    expect(result).toMatchObject({
      id: workItemId,
      parentId: parentWorkItemId,
      kind: "task",
    });
  });

  it("rejects promoteToTask when the caller is not a member of the work item's workspace", async () => {
    findFirstMocks.workItems.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parentId: parentWorkItemId,
      projectId: "44444444-4444-4444-8444-444444444444",
      sequenceNumber: 17,
      kind: "issue",
      title: "Investigate flaky deploy preview",
      status: "draft",
    });
    findFirstMocks.workspaceMembers.mockResolvedValueOnce(null);
    updateReturningMock.mockResolvedValueOnce([
      {
        id: workItemId,
        kind: "task",
      },
    ]);

    const caller = createCaller();

    await expect(
      caller.workItems.promoteToTask({
        id: workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
