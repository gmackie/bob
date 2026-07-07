import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let appRouter: typeof import("../../root").appRouter;

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();
const dbUpdateReturningMock = vi.fn();
const chatConversationsFindFirstMock = vi.fn();

const makeDbMock = () => ({
  query: {
    chatConversations: {
      findFirst: chatConversationsFindFirstMock,
    },
  },
  update: (table: unknown) => {
    dbUpdateMock(table);

    return {
      set: (patch: unknown) => {
        dbUpdateSetMock(patch);

        return {
          where: (predicate: unknown) => {
            dbUpdateWhereMock(predicate);

            return {
              returning: () => dbUpdateReturningMock(),
            };
          },
        };
      },
    };
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

describe("session.claimLease", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbUpdateReturningMock.mockReset();
    chatConversationsFindFirstMock.mockReset();
  });

  it("claims a lease with one conditional update", async () => {
    dbUpdateReturningMock.mockResolvedValueOnce([
      {
        id: sessionId,
        userId: "user-1",
        claimedByGatewayId: "gateway-1",
      },
    ]);

    const caller = createCaller() as any;
    const result = await caller.session.claimLease({
      sessionId,
      gatewayId: "gateway-1",
      leaseMs: 30_000,
    });

    expect(result).toMatchObject({
      id: sessionId,
      claimedByGatewayId: "gateway-1",
    });
    expect(dbUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ claimedByGatewayId: "gateway-1" }),
    );
    expect(dbUpdateWhereMock).toHaveBeenCalledTimes(1);
    expect(chatConversationsFindFirstMock).not.toHaveBeenCalled();
  });

  it("reports conflict when the conditional lease update loses", async () => {
    dbUpdateReturningMock.mockResolvedValueOnce([]);
    chatConversationsFindFirstMock.mockResolvedValueOnce({
      id: sessionId,
      userId: "user-1",
      claimedByGatewayId: "gateway-2",
    });

    const caller = createCaller() as any;

    await expect(
      caller.session.claimLease({
        sessionId,
        gatewayId: "gateway-1",
        leaseMs: 30_000,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Session claimed by gateway gateway-2",
    });
  });
});
