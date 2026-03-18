import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    apiKeyAuth: null as any,
    db: {} as any,
  });

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

      const caller = createCaller() as any;
      const result = await caller.requirement.list({ workItemId });

      expect(result.api).toBeDefined();
      expect(result.api.total).toBe(2);
      expect(result.api.done).toBe(1);
      expect(result.api.items).toHaveLength(2);

      expect(result.ui).toBeDefined();
      expect(result.ui.total).toBe(1);
      expect(result.ui.done).toBe(0);
    });

    it("returns empty object when no requirements exist", async () => {
      selectOrderByMock.mockResolvedValueOnce([]);

      const caller = createCaller() as any;
      const result = await caller.requirement.list({ workItemId });

      expect(result).toEqual({});
    });
  });

  describe("create", () => {
    it("inserts a requirement and returns it", async () => {
      const created = {
        id: requirementId,
        workItemId,
        category: "data",
        description: "Add migration for users table",
        sortOrder: 0,
        status: "pending",
      };
      insertReturningMock.mockResolvedValueOnce([created]);

      const caller = createCaller() as any;
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
      const caller = createCaller() as any;
      await expect(
        caller.requirement.create({
          workItemId,
          category: "invalid_category",
          description: "test",
        }),
      ).rejects.toThrow();
    });

    it("rejects empty description", async () => {
      const caller = createCaller() as any;
      await expect(
        caller.requirement.create({
          workItemId,
          category: "api",
          description: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("update", () => {
    it("changes status of a requirement", async () => {
      const updated = {
        id: requirementId,
        workItemId,
        category: "api",
        description: "Create REST endpoints",
        status: "done",
        sortOrder: 0,
      };
      updateReturningMock.mockResolvedValueOnce([updated]);

      const caller = createCaller() as any;
      const result = await caller.requirement.update({
        id: requirementId,
        status: "done",
      });

      expect(updateSetMock).toHaveBeenCalledWith({ status: "done" });
      expect(result).toMatchObject({ id: requirementId, status: "done" });
    });

    it("rejects invalid status value", async () => {
      const caller = createCaller() as any;
      await expect(
        caller.requirement.update({
          id: requirementId,
          status: "invalid_status",
        }),
      ).rejects.toThrow();
    });
  });

  describe("delete", () => {
    it("removes a requirement and returns success", async () => {
      deleteWhereMock.mockResolvedValueOnce(undefined);

      const caller = createCaller() as any;
      const result = await caller.requirement.delete({ id: requirementId });

      expect(mockDb.delete).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("rejects non-uuid id", async () => {
      const caller = createCaller() as any;
      await expect(
        caller.requirement.delete({ id: "not-a-uuid" }),
      ).rejects.toThrow();
    });
  });

  describe("linkToTask", () => {
    it("sets linkedTaskId on a requirement", async () => {
      const updated = {
        id: requirementId,
        workItemId,
        category: "api",
        description: "Create REST endpoints",
        status: "pending",
        linkedTaskId: taskId,
        sortOrder: 0,
      };
      updateReturningMock.mockResolvedValueOnce([updated]);

      const caller = createCaller() as any;
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
  });
});
