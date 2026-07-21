import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/select surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

let appRouter: typeof import("../../root").appRouter;

const selectWhereMock = vi.fn();
const selectOrderByMock = vi.fn();
const selectLimitMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const workItemsFindFirstMock = vi.fn();
const workspaceMembersFindFirstMock = vi.fn();

const makeDbMock = () => ({
  query: {
    workItems: {
      findFirst: workItemsFindFirstMock,
    },
    workspaceMembers: {
      findFirst: workspaceMembersFindFirstMock,
    },
  },
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: selectWhereMock.mockImplementation(() => ({
        orderBy: selectOrderByMock,
        limit: selectLimitMock,
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock.mockReturnValue({
      returning: insertReturningMock,
    }),
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

describe("snapshot router", () => {
  const workItemId = "11111111-1111-4111-8111-111111111111";
  const snapshotId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  }, 60_000);

  beforeEach(() => {
    [
      selectWhereMock,
      selectOrderByMock,
      selectLimitMock,
      insertValuesMock,
      insertReturningMock,
      workItemsFindFirstMock,
      workspaceMembersFindFirstMock,
    ].forEach((mock) => mock.mockReset());
  });

  it("creates a snapshot for an accessible work item", async () => {
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce({
      id: "membership-1",
    });
    insertReturningMock.mockResolvedValueOnce([
      {
        id: snapshotId,
        workItemId,
        stage: "review",
        data: { ok: true },
      },
    ]);

    const caller = createCaller();
    const result = await caller.snapshot.create({
      workItemId,
      stage: "review",
      data: { ok: true },
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId,
        stage: "review",
      }),
    );
    expect(result).toMatchObject({
      id: snapshotId,
      workItemId,
      stage: "review",
    });
  });

  it("rejects snapshot creation when the caller is not a member of the work item's workspace", async () => {
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.snapshot.create({
        workItemId,
        stage: "review",
        data: { ok: true },
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects snapshot listing when the caller is not a member of the work item's workspace", async () => {
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.snapshot.list({ workItemId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects snapshot lookup by id when the caller is not a member of the snapshot work item's workspace", async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: snapshotId,
        workItemId,
        stage: "review",
        data: { ok: true },
      },
    ]);
    workItemsFindFirstMock.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    workspaceMembersFindFirstMock.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.snapshot.get({ id: snapshotId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
