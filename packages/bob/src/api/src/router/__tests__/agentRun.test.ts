import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query surface these handlers
// actually call, cast through `unknown` (not `any`) at the single
// construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  agentRunsFindMany: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
  workItemsFindFirst: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    agentRuns: {
      findMany: queryMocks.agentRunsFindMany,
    },
    workspaceMembers: {
      findFirst: queryMocks.workspaceMembersFindFirst,
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

describe("agentRun router access control", () => {
  const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workItemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
  });

  it("rejects workspace run listing when the caller is not a member of the workspace", async () => {
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.agentRun.list({ workspaceId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects work item run listing when the caller is not a member of the work item's workspace", async () => {
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: workItemId,
      workspaceId,
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.agentRun.listByWorkItem({ workItemId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
