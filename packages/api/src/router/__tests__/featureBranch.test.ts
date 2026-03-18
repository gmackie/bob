import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the direct db import used by the featureBranch router
const selectFromMock = vi.fn();
const selectWhereMock = vi.fn();
const selectGroupByMock = vi.fn();
const selectLeftJoinMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

const mockDb = {
  select: vi.fn(() => ({
    from: selectFromMock.mockReturnValue({
      where: selectWhereMock.mockReturnValue({
        groupBy: selectGroupByMock,
      }),
      leftJoin: selectLeftJoinMock.mockReturnValue({
        where: selectWhereMock.mockReturnValue({
          groupBy: selectGroupByMock,
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: selectWhereMock,
        }),
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
};

vi.mock("@bob/db/client", () => ({ db: mockDb }));

// Mock the prService to avoid actual git operations
vi.mock("../../services/git/prService", () => ({
  createDraftPr: vi.fn(),
}));

let appRouter: typeof import("../../root").appRouter;
let createDraftPrMock: ReturnType<typeof vi.fn>;

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

describe("featureBranch router", () => {
  const workItemId = "11111111-1111-4111-8111-111111111111";
  const repositoryId = "22222222-2222-4222-8222-222222222222";
  const featureBranchId = "33333333-3333-4333-8333-333333333333";
  const pullRequestId = "44444444-4444-4444-8444-444444444444";

  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
    const prService = await import("../../services/git/prService");
    createDraftPrMock = prService.createDraftPr as ReturnType<typeof vi.fn>;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("inserts a feature branch and returns it", async () => {
      const created = {
        id: featureBranchId,
        workItemId,
        repositoryId,
        branchName: "feat/new-feature",
        baseBranch: "main",
        status: "active",
        featurePrId: null,
        createdAt: new Date(),
      };
      insertReturningMock.mockResolvedValueOnce([created]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.create({
        workItemId,
        repositoryId,
        branchName: "feat/new-feature",
      });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemId,
          repositoryId,
          branchName: "feat/new-feature",
          baseBranch: "main",
        }),
      );
      expect(result).toMatchObject({
        id: featureBranchId,
        branchName: "feat/new-feature",
      });
    });

    it("uses custom baseBranch when provided", async () => {
      insertReturningMock.mockResolvedValueOnce([
        {
          id: featureBranchId,
          workItemId,
          repositoryId,
          branchName: "feat/hotfix",
          baseBranch: "develop",
        },
      ]);

      const caller = createCaller() as any;
      await caller.featureBranch.create({
        workItemId,
        repositoryId,
        branchName: "feat/hotfix",
        baseBranch: "develop",
      });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ baseBranch: "develop" }),
      );
    });

    it("rejects empty branchName", async () => {
      const caller = createCaller() as any;
      await expect(
        caller.featureBranch.create({
          workItemId,
          repositoryId,
          branchName: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("get", () => {
    it("returns feature branch with task PRs", async () => {
      // First select for the branch itself
      selectWhereMock.mockResolvedValueOnce([
        {
          id: featureBranchId,
          workItemId,
          repositoryId,
          branchName: "feat/new-feature",
          baseBranch: "main",
          status: "active",
          featurePrId: null,
          createdAt: new Date(),
        },
      ]);

      // Second select for task PRs (via leftJoin chain)
      selectWhereMock.mockResolvedValueOnce([
        {
          id: "task-pr-1",
          featureBranchId,
          pullRequestId,
          mergedAt: null,
          createdAt: new Date(),
          pullRequest: { id: pullRequestId, title: "Fix bug" },
        },
      ]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.get({ id: featureBranchId });

      expect(result).toMatchObject({
        id: featureBranchId,
        branchName: "feat/new-feature",
      });
      expect(result.taskPRs).toHaveLength(1);
    });

    it("returns null when branch not found", async () => {
      selectWhereMock.mockResolvedValueOnce([]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.get({ id: featureBranchId });

      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("returns branches with PR counts", async () => {
      selectGroupByMock.mockResolvedValueOnce([
        {
          id: featureBranchId,
          workItemId,
          repositoryId,
          branchName: "feat/new-feature",
          baseBranch: "main",
          status: "active",
          featurePrId: null,
          createdAt: new Date(),
          taskPRCount: 3,
        },
      ]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.list({ workItemId });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: featureBranchId,
        taskPRCount: 3,
      });
    });
  });

  describe("addTaskPR", () => {
    it("creates junction record", async () => {
      const created = {
        id: "task-pr-1",
        featureBranchId,
        pullRequestId,
        mergedAt: null,
        createdAt: new Date(),
      };
      insertReturningMock.mockResolvedValueOnce([created]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.addTaskPR({
        featureBranchId,
        pullRequestId,
      });

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({ featureBranchId, pullRequestId }),
      );
      expect(result).toMatchObject({
        featureBranchId,
        pullRequestId,
        mergedAt: null,
      });
    });
  });

  describe("markTaskPRMerged", () => {
    it("sets mergedAt timestamp", async () => {
      const mergedAt = new Date();
      updateReturningMock.mockResolvedValueOnce([
        {
          id: "task-pr-1",
          featureBranchId,
          pullRequestId,
          mergedAt,
          createdAt: new Date(),
        },
      ]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.markTaskPRMerged({
        featureBranchId,
        pullRequestId,
      });

      expect(updateSetMock).toHaveBeenCalledWith({
        mergedAt: expect.any(Date),
      });
      expect(result).toMatchObject({ mergedAt });
    });
  });

  describe("updateStatus", () => {
    it("changes status of a feature branch", async () => {
      updateReturningMock.mockResolvedValueOnce([
        {
          id: featureBranchId,
          workItemId,
          repositoryId,
          branchName: "feat/new-feature",
          baseBranch: "main",
          status: "ready",
          featurePrId: null,
          createdAt: new Date(),
        },
      ]);

      const caller = createCaller() as any;
      const result = await caller.featureBranch.updateStatus({
        id: featureBranchId,
        status: "ready",
      });

      expect(updateSetMock).toHaveBeenCalledWith({ status: "ready" });
      expect(result).toMatchObject({ status: "ready" });
    });

    it("rejects invalid status", async () => {
      const caller = createCaller() as any;
      await expect(
        caller.featureBranch.updateStatus({
          id: featureBranchId,
          status: "invalid_status",
        }),
      ).rejects.toThrow();
    });
  });

  describe("createFeaturePR", () => {
    it("wraps errors from prService in TRPCError", async () => {
      // The branch lookup
      selectWhereMock.mockResolvedValueOnce([
        {
          id: featureBranchId,
          workItemId,
          repositoryId,
          branchName: "feat/new-feature",
          baseBranch: "main",
          status: "active",
        },
      ]);

      createDraftPrMock.mockRejectedValueOnce(
        new Error("GitHub API rate limited"),
      );

      const caller = createCaller() as any;
      await expect(
        caller.featureBranch.createFeaturePR({
          featureBranchId,
          title: "Feature: New feature",
          repositoryId,
        }),
      ).rejects.toThrow("Failed to create pull request for feature branch");
    });

    it("throws when feature branch not found", async () => {
      selectWhereMock.mockResolvedValueOnce([]);

      const caller = createCaller() as any;
      await expect(
        caller.featureBranch.createFeaturePR({
          featureBranchId,
          title: "Feature: New feature",
          repositoryId,
        }),
      ).rejects.toThrow("Feature branch not found");
    });
  });
});
