import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/select surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const selectWhereMock = vi.fn();
const selectLimitMock = vi.fn();
const selectOrderByMock = vi.fn();
const selectLeftJoinMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();
const chatConversationsFindFirstMock = vi.fn();
const workItemsFindFirstMock = vi.fn();
const workspaceMembersFindFirstMock = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: selectWhereMock.mockImplementation(() => ({
        limit: selectLimitMock,
        orderBy: selectOrderByMock,
      })),
      leftJoin: selectLeftJoinMock.mockImplementation(() => ({
        where: selectWhereMock.mockImplementation(() => ({
          limit: selectLimitMock,
          orderBy: selectOrderByMock,
        })),
      })),
    })),
  })),
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
  query: {
    chatConversations: {
      findFirst: chatConversationsFindFirstMock,
    },
    workItems: {
      findFirst: workItemsFindFirstMock,
    },
    workspaceMembers: {
      findFirst: workspaceMembersFindFirstMock,
    },
  },
};

vi.mock("@bob/db/client", () => ({ db: mockDb }));

let appRouter: typeof import("../../root").appRouter;

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
    db: mockDb,
  } as unknown as TRPCContext);

describe("skill router", () => {
  const executionId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const workItemId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    [
      selectWhereMock,
      selectLimitMock,
      selectOrderByMock,
      selectLeftJoinMock,
      insertValuesMock,
      insertReturningMock,
      updateSetMock,
      updateWhereMock,
      updateReturningMock,
      chatConversationsFindFirstMock,
      workItemsFindFirstMock,
      workspaceMembersFindFirstMock,
    ].forEach((mock) => mock.mockReset());
  });

  it("rejects execution lookup when the linked work item is not accessible", async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        execution: {
          id: executionId,
          sessionId: null,
          workItemId,
          parentExecutionId: null,
        },
        skillName: "QA Testing",
      },
    ]);
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.skill.getExecution({ id: executionId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects execution listing when the linked session is not owned by the caller", async () => {
    chatConversationsFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.skill.listExecutions({ sessionId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects execution recording when the linked work item is not accessible", async () => {
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.skill.recordExecution({
        workItemId,
        skillSlug: "qa",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects unscoped execution recording", async () => {
    const caller = createCaller();

    await expect(
      caller.skill.recordExecution({
        skillSlug: "qa",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects execution updates when the linked session is not owned by the caller", async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: executionId,
        sessionId,
        workItemId: null,
        parentExecutionId: null,
      },
    ]);
    chatConversationsFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.skill.updateExecution({
        id: executionId,
        status: "completed",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
