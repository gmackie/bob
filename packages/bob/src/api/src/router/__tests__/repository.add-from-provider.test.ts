import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert surface these
// handlers actually call, cast through `unknown` (not `any`) at the single
// construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

let appRouter: typeof import("../../root").appRouter;

const queryMocks = {
  repositoriesFindFirst: vi.fn(),
  projectsFindFirst: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
};

const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();

const makeDbMock = () => ({
  query: {
    repositories: {
      findFirst: queryMocks.repositoriesFindFirst,
    },
    projects: {
      findFirst: queryMocks.projectsFindFirst,
    },
    workspaceMembers: {
      findFirst: queryMocks.workspaceMembersFindFirst,
    },
  },
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

describe("repository.addFromProvider", () => {
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ({
        ok: true,
        json: () => Promise.resolve({}),
      })),
    );
    ({ appRouter } = await import("../../root"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    Object.values(queryMocks).forEach((mock) => mock.mockReset());
    insertValuesMock.mockReset();
    insertReturningMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ({
        ok: true,
        json: () => Promise.resolve({}),
      })),
    );
  });

  it("rejects provider repository registration when the linked project is not in a workspace the caller can access", async () => {
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.repository.addFromProvider({
        fullName: "acme/demo",
        cloneUrl: "https://example.com/acme/demo.git",
        htmlUrl: "https://example.com/acme/demo",
        projectId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("stores the linked planning project when the caller can access it", async () => {
    queryMocks.projectsFindFirst.mockResolvedValueOnce({
      id: projectId,
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    queryMocks.repositoriesFindFirst.mockResolvedValueOnce(null);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "repo-1",
        name: "demo",
        planningProjectId: projectId,
      },
    ]);

    const caller = createCaller();
    const result = await caller.repository.addFromProvider({
      fullName: "acme/demo",
      cloneUrl: "https://example.com/acme/demo.git",
      htmlUrl: "https://example.com/acme/demo",
      projectId,
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        planningProjectId: projectId,
      }),
    );
    expect(result).toMatchObject({
      id: "repo-1",
      planningProjectId: projectId,
    });
  });
});
