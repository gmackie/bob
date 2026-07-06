import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

let appRouter: typeof import("../../root").appRouter;

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/select surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const selectWhereMock = vi.fn();
const selectOrderByMock = vi.fn();

const queryMocks = {
  chatConversationsFindFirst: vi.fn(),
  chatMessagesFindFirst: vi.fn(),
  workItemsFindFirst: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
  repositoriesFindFirst: vi.fn(),
  worktreesFindFirst: vi.fn(),
};

const makeDbMock = () => ({
  query: {
    chatConversations: {
      findFirst: queryMocks.chatConversationsFindFirst,
    },
    chatMessages: {
      findFirst: queryMocks.chatMessagesFindFirst,
    },
    workItems: {
      findFirst: queryMocks.workItemsFindFirst,
    },
    workspaceMembers: {
      findFirst: queryMocks.workspaceMembersFindFirst,
    },
    repositories: {
      findFirst: queryMocks.repositoriesFindFirst,
    },
    worktrees: {
      findFirst: queryMocks.worktreesFindFirst,
    },
  },
  insert: vi.fn(() => ({
    values: insertValuesMock.mockReturnValue({
      returning: insertReturningMock,
    }),
  })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: selectWhereMock.mockReturnValue({
        orderBy: selectOrderByMock,
      }),
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

describe("chat router", () => {
  const workItemId = "11111111-1111-4111-8111-111111111111";
  const messageId = "22222222-2222-4222-8222-222222222222";
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const repositoryId = "44444444-4444-4444-8444-444444444444";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    [
      insertValuesMock,
      insertReturningMock,
      selectWhereMock,
      selectOrderByMock,
      ...Object.values(queryMocks),
    ].forEach((mock) => mock.mockReset());
  });

  it("rejects conversation creation when the caller is not a member of the linked work item's workspace", async () => {
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.chat.createConversation({
        workItemId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects conversation creation when the repository is not owned by the caller", async () => {
    queryMocks.repositoriesFindFirst.mockResolvedValueOnce(null);

    const caller = createCaller();

    await expect(
      caller.chat.createConversation({
        repositoryId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("creates a conversation when linked resources are accessible", async () => {
    queryMocks.repositoriesFindFirst.mockResolvedValueOnce({ id: repositoryId });
    queryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: workItemId,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    queryMocks.workspaceMembersFindFirst.mockResolvedValueOnce({
      id: "membership-1",
    });
    insertReturningMock.mockResolvedValueOnce([
      {
        id: conversationId,
        userId: "user-1",
        repositoryId,
        workItemId,
      },
    ]);

    const caller = createCaller();
    const result = await caller.chat.createConversation({
      repositoryId,
      workItemId,
      title: "New thread",
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        repositoryId,
        workItemId,
        title: "New thread",
      }),
    );
    expect(result).toMatchObject({
      id: conversationId,
      repositoryId,
      workItemId,
    });
  });

  it("rejects image attachment when the message does not belong to the caller", async () => {
    queryMocks.chatMessagesFindFirst.mockResolvedValueOnce({
      id: messageId,
      conversation: {
        id: conversationId,
        userId: "user-2",
      },
    });

    const caller = createCaller();

    await expect(
      caller.chat.attachImage({
        messageId,
        url: "https://example.com/image.png",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects attachment listing when the message does not belong to the caller", async () => {
    queryMocks.chatMessagesFindFirst.mockResolvedValueOnce({
      id: messageId,
      conversation: {
        id: conversationId,
        userId: "user-2",
      },
    });

    const caller = createCaller();

    await expect(
      caller.chat.getAttachments({ messageId }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("attaches an image for a caller-owned message", async () => {
    queryMocks.chatMessagesFindFirst.mockResolvedValueOnce({
      id: messageId,
      conversation: {
        id: conversationId,
        userId: "user-1",
      },
    });
    insertReturningMock.mockResolvedValueOnce([
      {
        id: "attachment-1",
        messageId,
        type: "image",
        url: "https://example.com/image.png",
      },
    ]);

    const caller = createCaller();
    const result = await caller.chat.attachImage({
      messageId,
      url: "https://example.com/image.png",
      filename: "image.png",
    });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId,
        url: "https://example.com/image.png",
        filename: "image.png",
      }),
    );
    expect(result).toMatchObject({
      id: "attachment-1",
      messageId,
    });
  });
});
