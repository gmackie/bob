import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/test";

type MockDb = ReturnType<typeof createMockDb>;

const createMockDb = () => ({
  query: {
    workspaceMembers: {
      findFirst: vi.fn(),
    },
    workItems: {
      findMany: vi.fn(),
    },
    chatConversations: {
      findMany: vi.fn(),
    },
  },
});

let createCaller: (db: MockDb, withApiKey?: boolean) => ReturnType<any>;

beforeAll(async () => {
  const { createTRPCRouter } = await import("../../trpc");
  const { publicWorkItemsRouter } = await import("../workItems");

  const router = createTRPCRouter({
    publicWorkItems: publicWorkItemsRouter,
  });

  createCaller = (db: MockDb, withApiKey = true) =>
    router.createCaller({
      session: {
        user: {
          id: "user-1",
        },
      },
      authApi: {
        getSession: vi.fn(),
      },
      apiKeyAuth: withApiKey
        ? {
            keyId: "key-1",
            permissions: ["read", "write"],
            user: {
              id: "user-1",
            },
            userId: "user-1",
          }
        : null,
      db,
    } as any);
});

describe("publicWorkItems router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows listing work items with an API key", async () => {
    const db = createMockDb();
    db.query.workspaceMembers.findFirst.mockResolvedValueOnce({ id: "member-1" });
    db.query.workItems.findMany.mockResolvedValueOnce([
      {
        id: "work-item-1",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        projectId: null,
        parentId: null,
        kind: "issue",
        status: "todo",
        title: "Task 1",
        description: null,
        sequenceNumber: 1,
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);
    db.query.chatConversations.findMany.mockResolvedValueOnce([]);

    const caller = createCaller(db) as any;

    await expect(
      caller.publicWorkItems.list({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        limit: 20,
      }),
    ).resolves.toHaveLength(1);
  });

  it("rejects listing work items without an API key", async () => {
    const db = createMockDb();
    const caller = createCaller(db, false) as any;

    await expect(
      caller.publicWorkItems.list({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        limit: 20,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "API key required",
    });
  });
});
