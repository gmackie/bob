import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query surface these handlers
// actually call, cast through `unknown` (not `any`) at the single
// construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  chatConversationsFindFirst: vi.fn(),
  taskRunsFindFirst: vi.fn(),
  workItemsFindFirst: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    chatConversations: {
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    taskRuns: {
      findFirst: queryMocks.taskRunsFindFirst,
    },
    workItems: {
      findFirst: queryMocks.workItemsFindFirst,
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
    authApi: { getSession: vi.fn() },
    apiKeyAuth: null,
    db: makeDbMock(),
  } as unknown as TRPCContext);

describe("session router linked task URLs", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    queryMocks.chatConversationsFindFirst.mockReset();
    queryMocks.taskRunsFindFirst.mockReset();
    queryMocks.workItemsFindFirst.mockReset();
  });

  it("builds linked task URLs from planning host aliases and work-item routes", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: sessionId,
      userId: "user-1",
      workingDirectory: "/repo/demo",
      status: "running",
      workItemId,
      workItemIdentifierSnapshot: "PLAN-123",
      planningTaskId: workItemId,
      repository: null,
      worktree: null,
    });
    queryMocks.taskRunsFindFirst.mockResolvedValueOnce({
      id: "run-1",
      sessionId,
      userId: "user-1",
      workItemId,
      workItemIdentifierSnapshot: "PLAN-123",
      planningItemId: workItemId,
      planningItemIdentifier: "PLAN-123",
    });

    const caller = createCaller();
    const result = await caller.session.get({ id: sessionId });

    expect(result.linkedTask).toEqual({
      id: workItemId,
      identifier: "PLAN-123",
      url: `/work-items/${workItemId}`,
    });
    expect(result.workItemId).toBe(workItemId);
    expect(result.workItemIdentifier).toBe("PLAN-123");
  });

  it("resolves projectId from the latest task run work item when the session snapshot lacks it", async () => {
    queryMocks.chatConversationsFindFirst.mockResolvedValueOnce({
      id: sessionId,
      userId: "user-1",
      workingDirectory: "/repo/demo",
      status: "running",
      workItemId: null,
      workItemIdentifierSnapshot: null,
      planningTaskId: null,
      repository: null,
      worktree: null,
      workItem: null,
    });
    queryMocks.taskRunsFindFirst.mockResolvedValueOnce({
      id: "run-2",
      sessionId,
      userId: "user-1",
      workItemId,
      workItemIdentifierSnapshot: "PLAN-123",
      planningItemId: workItemId,
      planningItemIdentifier: "PLAN-123",
    });
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: workItemId,
      projectId: "33333333-3333-4333-8333-333333333333",
    });

    const caller = createCaller();
    const result = await caller.session.get({ id: sessionId });

    expect(result.projectId).toBe("33333333-3333-4333-8333-333333333333");
  });
});
