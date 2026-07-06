import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/select surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const selectWhereMock = vi.fn();
const selectOrderByMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const getPrByIdMock = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      leftJoin: vi.fn(() => ({
        where: selectWhereMock.mockReturnValue({
          orderBy: selectOrderByMock,
        }),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock.mockReturnValue({
      returning: insertReturningMock,
    }),
  })),
};

vi.mock("@bob/db/client", () => ({ db: mockDb }));
vi.mock("../../services/git/prService", () => ({
  createDraftPr: vi.fn(),
  getPrById: getPrByIdMock,
  linkPrToPlanningTask: vi.fn(),
  listAllPrs: vi.fn(),
  listPrsByRepository: vi.fn(),
  listPrsBySession: vi.fn(),
  mergePr: vi.fn(),
  refreshPrFromRemote: vi.fn(),
  syncCommits: vi.fn(),
  updatePr: vi.fn(),
}));

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
    // Not exercised by this file's tests — access-control checks here go
    // through the mocked prService (getPrById) / module-mocked @bob/db/client,
    // not ctx.db directly.
    db: {},
  } as unknown as TRPCContext);

describe("pullRequest router access control", () => {
  const pullRequestId = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    [
      selectWhereMock,
      selectOrderByMock,
      insertValuesMock,
      insertReturningMock,
      getPrByIdMock,
    ].forEach((mock) => mock.mockReset());
  });

  it("rejects review listing when the caller cannot access the pull request", async () => {
    getPrByIdMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.pullRequest.listReviews({ pullRequestId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects review creation when the caller cannot access the pull request", async () => {
    getPrByIdMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.pullRequest.addReview({
        pullRequestId,
        status: "approved",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates a review when the caller can access the pull request", async () => {
    getPrByIdMock.mockResolvedValueOnce({ id: pullRequestId });
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "review-1",
        pullRequestId,
        userId: "user-1",
        status: "approved",
      },
    ]);

    const caller = createCaller();
    const result = await caller.pullRequest.addReview({
      pullRequestId,
      status: "approved",
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId,
        userId: "user-1",
        status: "approved",
      }),
    );
    expect(result).toMatchObject({
      id: "review-1",
      pullRequestId,
      status: "approved",
    });
  });
});
