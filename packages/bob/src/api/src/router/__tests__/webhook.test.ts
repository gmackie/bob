import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const workspaceMembersFindFirstMock = vi.fn();

const mockDb = {
  insert: vi.fn(() => ({
    values: insertValuesMock.mockReturnValue({
      returning: insertReturningMock,
    }),
  })),
  query: {
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
    authApi: { getSession: vi.fn() } as any,
    apiKeyAuth: null,
    db: {} as any,
  });

describe("webhook router access control", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    [insertValuesMock, insertReturningMock, workspaceMembersFindFirstMock].forEach((mock) =>
      mock.mockReset(),
    );
  });

  it("rejects workspace-scoped webhook creation when the caller is not a member of the workspace", async () => {
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller() as any;

    await expect(
      caller.webhook.create({
        workspaceId,
        url: "https://example.com/webhook",
        secret: "1234567890abcdef",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates a workspace-scoped webhook when the caller is a member", async () => {
    workspaceMembersFindFirstMock.mockResolvedValueOnce({
      id: "membership-1",
    });
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "webhook-1",
        userId: "user-1",
        workspaceId,
        url: "https://example.com/webhook",
      },
    ]);

    const caller = createCaller() as any;
    const result = await caller.webhook.create({
      workspaceId,
      url: "https://example.com/webhook",
      secret: "1234567890abcdef",
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        workspaceId,
      }),
    );
    expect(result).toMatchObject({
      id: "webhook-1",
      workspaceId,
    });
  });
});
