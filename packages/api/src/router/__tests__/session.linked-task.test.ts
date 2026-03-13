import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  chatConversationsFindFirst: vi.fn(),
  taskRunsFindFirst: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    chatConversations: {
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    taskRuns: {
      findFirst: queryMocks.taskRunsFindFirst,
    },
  },
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

describe("session router linked task URLs", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    delete process.env.KANBANGER_URL;
    process.env.PLANNING_URL = "https://planning.example.internal";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    queryMocks.chatConversationsFindFirst.mockReset();
    queryMocks.taskRunsFindFirst.mockReset();
  });

  it("builds linked task URLs from planning host aliases and work-item routes", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: sessionId,
      userId: "user-1",
      workingDirectory: "/repo/demo",
      status: "running",
      workItemId,
      workItemIdentifierSnapshot: "PLAN-123",
      kanbangerTaskId: workItemId,
      repository: null,
      worktree: null,
    });
    queryMocks.taskRunsFindFirst.mockResolvedValueOnce({
      id: "run-1",
      sessionId,
      userId: "user-1",
      workItemId,
      workItemIdentifierSnapshot: "PLAN-123",
      kanbangerIssueId: workItemId,
      kanbangerIssueIdentifier: "PLAN-123",
    });

    const caller = createCaller() as any;
    const result = await caller.session.get({ id: sessionId });

    expect(result.linkedTask).toEqual({
      id: workItemId,
      identifier: "PLAN-123",
      url: `https://planning.example.internal/work-items/${workItemId}`,
    });
    expect(result.workItemId).toBe(workItemId);
    expect(result.workItemIdentifier).toBe("PLAN-123");
  });
});
