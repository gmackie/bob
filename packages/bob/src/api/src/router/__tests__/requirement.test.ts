import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { createTRPCContext } from "../../trpc.js";

// The real tRPC context type — the mock db/authApi below are structurally
// close-enough fakes that only implement the query/insert/update surface
// these handlers actually call, cast through `unknown` (not `any`) at the
// single construction site so every caller.* call below stays fully typed.
type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

// Mock the direct db import used by the requirement router
const selectFromMock = vi.fn();
const selectWhereMock = vi.fn();
const selectOrderByMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteWhereMock = vi.fn();
const workItemsFindFirstMock = vi.fn();
const workspaceMembersFindFirstMock = vi.fn();
const requirementsFindFirstMock = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: selectFromMock.mockReturnValue({
      where: selectWhereMock.mockReturnValue({
        orderBy: selectOrderByMock,
      }),
    }),
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
  delete: vi.fn(() => ({
    where: deleteWhereMock,
  })),
  query: {
    workItems: {
      findFirst: workItemsFindFirstMock,
    },
    requirements: {
      findFirst: requirementsFindFirstMock,
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

describe("requirement router", () => {
  const workItemId = "11111111-1111-4111-8111-111111111111";
  const requirementId = "22222222-2222-4222-8222-222222222222";
  const taskId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list", () => {
    it("returns grouped requirements with completion counts", async () => {
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });
      selectOrderByMock.mockResolvedValueOnce([
        {
          id: "r1",
          workItemId,
          category: "api",
          description: "Create REST endpoints",
          status: "done",
          sortOrder: 0,
        },
        {
          id: "r2",
          workItemId,
          category: "api",
          description: "Add auth middleware",
          status: "pending",
          sortOrder: 1,
        },
        {
          id: "r3",
          workItemId,
          category: "ui",
          description: "Build form component",
          status: "pending",
          sortOrder: 0,
        },
      ]);

      const caller = createCaller();
      const result = await caller.requirement.list({ workItemId });

      if (!result.api) throw new Error("expected result.api to be defined");
      expect(result.api.total).toBe(2);
      expect(result.api.done).toBe(1);
      expect(result.api.items).toHaveLength(2);

      if (!result.ui) throw new Error("expected result.ui to be defined");
      expect(result.ui.total).toBe(1);
      expect(result.ui.done).toBe(0);
    });

    it("returns empty object when no requirements exist", async () => {
      selectOrderByMock.mockResolvedValueOnce([]);
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });

      const caller = createCaller();
      const result = await caller.requirement.list({ workItemId });

      expect(result).toEqual({});
    });

    it("rejects list when the caller is not a member of the work item's workspace", async () => {
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce(null);
      selectOrderByMock.mockResolvedValueOnce([]);

      const caller = createCaller();

      await expect(caller.requirement.list({ workItemId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("create", () => {
    it("inserts a requirement and returns it", async () => {
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });
      const created = {
        id: requirementId,
        workItemId,
        category: "data",
        description: "Add migration for users table",
        sortOrder: 0,
        status: "pending",
      };
      insertReturningMock.mockResolvedValueOnce([created]);

      const caller = createCaller();
      const result = await caller.requirement.create({
        workItemId,
        category: "data",
        description: "Add migration for users table",
      });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId,
          category: "data",
          description: "Add migration for users table",
          sortOrder: 0,
        }),
      );
      expect(result).toMatchObject({ id: requirementId, category: "data" });
    });

    it("rejects invalid category", async () => {
      const caller = createCaller();
      await expect(
        caller.requirement.create({
          workItemId,
          // Deliberately not a member of the real category enum — this test
          // exercises the router's runtime (Zod) rejection of bad input, so
          // the value must be widened past the enum's TS type on purpose.
          category: "invalid_category" as unknown as "api",
          description: "test",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty description", async () => {
      const caller = createCaller();
      await expect(
        caller.requirement.create({
          workItemId,
          category: "api",
          description: "",
        }),
      ).rejects.toThrow();
    });

    it("rejects create when the caller is not a member of the work item's workspace", async () => {
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce(null);
      insertReturningMock.mockResolvedValueOnce([
        {
          id: requirementId,
          workItemId,
          category: "api",
          description: "Create REST endpoints",
          status: "pending",
          sortOrder: 0,
        },
      ]);

      const caller = createCaller();

      await expect(
        caller.requirement.create({
          workItemId,
          category: "api",
          description: "Create REST endpoints",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("update", () => {
    it("changes status of a requirement", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });
      const updated = {
        id: requirementId,
        workItemId,
        category: "api",
        description: "Create REST endpoints",
        status: "done",
        sortOrder: 0,
      };
      updateReturningMock.mockResolvedValueOnce([updated]);

      const caller = createCaller();
      const result = await caller.requirement.update({
        id: requirementId,
        status: "done",
      });

      expect(updateSetMock).toHaveBeenCalledWith({ status: "done" });
      expect(result).toMatchObject({ id: requirementId, status: "done" });
    });

    it("rejects invalid status value", async () => {
      const caller = createCaller();
      await expect(
        caller.requirement.update({
          id: requirementId,
          // Deliberately not a member of the real status enum — this test
          // exercises the router's runtime (Zod) rejection of bad input, so
          // the value must be widened past the enum's TS type on purpose.
          status: "invalid_status" as unknown as "done",
        }),
      ).rejects.toThrow();
    });

    it("rejects update when the caller is not a member of the requirement's workspace", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce(null);
      updateReturningMock.mockResolvedValueOnce([
        {
          id: requirementId,
          workItemId,
          status: "done",
        },
      ]);

      const caller = createCaller();

      await expect(
        caller.requirement.update({
          id: requirementId,
          status: "done",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("delete", () => {
    it("removes a requirement and returns success", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });
      deleteWhereMock.mockResolvedValueOnce(undefined);

      const caller = createCaller();
      const result = await caller.requirement.delete({ id: requirementId });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("rejects non-uuid id", async () => {
      const caller = createCaller();
      await expect(
        caller.requirement.delete({ id: "not-a-uuid" }),
      ).rejects.toThrow();
    });

    it("rejects delete when the caller is not a member of the requirement's workspace", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce(null);
      deleteWhereMock.mockResolvedValueOnce(undefined);

      const caller = createCaller();

      await expect(
        caller.requirement.delete({ id: requirementId }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("linkToTask", () => {
    it("sets linkedTaskId on a requirement", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce({
        id: "membership-1",
      });
      const updated = {
        id: requirementId,
        workItemId,
        category: "api",
        description: "Create REST endpoints",
        status: "pending",
        linkedTaskId: taskId,
        sortOrder: 0,
      };
      updateReturningMock.mockReset();
      updateReturningMock.mockResolvedValueOnce([updated]);

      const caller = createCaller();
      const result = await caller.requirement.linkToTask({
        id: requirementId,
        taskId,
      });

      expect(updateSetMock).toHaveBeenCalledWith({ linkedTaskId: taskId });
      expect(result).toMatchObject({
        id: requirementId,
        linkedTaskId: taskId,
      });
    });

    it("rejects linkToTask when the caller is not a member of the requirement's workspace", async () => {
      requirementsFindFirstMock.mockResolvedValueOnce({
        id: requirementId,
        workItemId,
      });
      workItemsFindFirstMock.mockResolvedValueOnce({
        id: workItemId,
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      });
      workspaceMembersFindFirstMock.mockResolvedValueOnce(null);
      updateReturningMock.mockResolvedValueOnce([
        {
          id: requirementId,
          workItemId,
          linkedTaskId: taskId,
        },
      ]);

      const caller = createCaller();

      await expect(
        caller.requirement.linkToTask({
          id: requirementId,
          taskId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
