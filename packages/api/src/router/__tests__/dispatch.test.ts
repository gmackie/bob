import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchBatches,
  dispatchItems,
  notifications,
} from "@bob/db/schema";

let appRouter: typeof import("../../root").appRouter;

// Track all DB calls
const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();
const dbUpdateReturningMock = vi.fn();

const dbQueryFindFirstMock = vi.fn();
const dbQueryFindManyMock = vi.fn();

// Valid v4 UUIDs
const BATCH_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const WORKSPACE_ID = "f47ac10b-58cc-4372-a567-0d02b2c3d479";
const PROJECT_ID = "6ba7b810-9dad-41d8-80b4-00c04fd430c8";
const DRAFT_ID = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRAFT_ID_2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ITEM_ID = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";
const ITEM_ID_2 = "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a";
const TASK_RUN_ID = "5e6f7a8b-9c0d-4e1f-aa3b-4c5d6e7f8a9b";

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);
    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);
        return {
          returning: () => dbInsertReturningMock(),
          onConflictDoNothing: () => Promise.resolve(),
        };
      },
    };
  },
  update: (table: unknown) => {
    dbUpdateMock(table);
    return {
      set: (values: unknown) => {
        dbUpdateSetMock(values);
        return {
          where: (condition: unknown) => {
            dbUpdateWhereMock(condition);
            return {
              returning: () => dbUpdateReturningMock(),
            };
          },
        };
      },
    };
  },
  query: {
    dispatchBatches: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("dispatchBatches", ...args),
      findMany: (...args: unknown[]) => dbQueryFindManyMock("dispatchBatches", ...args),
    },
    dispatchItems: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("dispatchItems", ...args),
    },
    planDrafts: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDrafts", ...args),
    },
    planDraftDependencies: {
      findMany: (...args: unknown[]) => dbQueryFindManyMock("planDraftDependencies", ...args),
    },
    taskRuns: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("taskRuns", ...args),
      findMany: (...args: unknown[]) => dbQueryFindManyMock("taskRuns", ...args),
    },
    forgeRevisions: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeRevisions", ...args),
    },
    forgeBuilds: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeBuilds", ...args),
    },
    forgeDeployments: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeDeployments", ...args),
    },
  },
});

const createCaller = (session: { id: string }) =>
  appRouter.createCaller({
    session: {
      session: {
        id: "auth-session-1",
        createdAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        userId: session.id,
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        token: "token-1",
        ipAddress: null,
        userAgent: null,
      },
      user: {
        id: session.id,
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

describe("dispatch router", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL ??=
      "postgres://postgres:postgres@localhost:5432/test";
    ({ appRouter } = await import("../../root"));
  });

  beforeEach(() => {
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertReturningMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbUpdateReturningMock.mockReset();
    dbQueryFindFirstMock.mockReset();
    dbQueryFindManyMock.mockReset();
  });

  describe("createBatch", () => {
    it("creates batch + items from committed drafts", async () => {
      const drafts = [
        {
          id: DRAFT_ID,
          sessionId: SESSION_ID,
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          title: "Task A",
          description: "Do A",
          kind: "task",
          status: "committed",
          sortOrder: 0,
        },
      ];

      // planDrafts.findMany (committed drafts)
      dbQueryFindManyMock
        .mockResolvedValueOnce(drafts)
        // planDraftDependencies.findMany (no deps)
        .mockResolvedValueOnce([])
        // dispatchItems.findMany (re-fetch after insert)
        .mockResolvedValueOnce([
          {
            id: ITEM_ID,
            batchId: BATCH_ID,
            planningTaskId: "task-1",
            planningTaskIdentifier: "TSK-1",
            title: "Task A",
            agentType: "claude",
            status: "queued",
            sortOrder: 0,
          },
        ]);

      // insert batch → returning
      dbInsertReturningMock
        .mockResolvedValueOnce([
          {
            id: BATCH_ID,
            userId: "user-1",
            sessionId: SESSION_ID,
            workspaceId: WORKSPACE_ID,
            projectId: PROJECT_ID,
            status: "pending",
            concurrency: 2,
            totalTasks: 1,
          },
        ])
        // insert dispatch items → returning
        .mockResolvedValueOnce([
          {
            id: ITEM_ID,
            batchId: BATCH_ID,
            planningTaskId: "task-1",
            planningTaskIdentifier: "TSK-1",
            title: "Task A",
            agentType: "claude",
            status: "queued",
            sortOrder: 0,
          },
        ]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.createBatch({
        sessionId: SESSION_ID,
        concurrency: 2,
        tasks: [
          { draftId: DRAFT_ID, taskId: "task-1", identifier: "TSK-1" },
        ],
      });

      expect(dbInsertMock).toHaveBeenCalledWith(dispatchBatches);
      expect(dbInsertMock).toHaveBeenCalledWith(dispatchItems);
      expect(result.batch).toMatchObject({ id: BATCH_ID, status: "pending" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        planningTaskId: "task-1",
        status: "queued",
      });
    });
  });

  describe("getBatch", () => {
    it("returns batch with items", async () => {
      const batch = {
        id: BATCH_ID,
        userId: "user-1",
        status: "running",
        concurrency: 2,
        totalTasks: 1,
      };

      const items = [
        {
          id: ITEM_ID,
          batchId: BATCH_ID,
          title: "Task A",
          status: "queued",
          sortOrder: 0,
        },
      ];

      dbQueryFindFirstMock.mockResolvedValueOnce(batch);
      dbQueryFindManyMock.mockResolvedValueOnce(items);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.getBatch({
        batchId: BATCH_ID,
      });

      expect(result.batch).toMatchObject({ id: BATCH_ID, status: "running" });
      expect(result.items).toHaveLength(1);
    });

    it("throws NOT_FOUND when batch does not exist", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.dispatch.getBatch({ batchId: BATCH_ID }),
      ).rejects.toThrow("Batch not found");
    });
  });

  describe("updateItemAgent", () => {
    it("changes agent type", async () => {
      const updatedItem = {
        id: ITEM_ID,
        agentType: "opencode",
        title: "Task A",
      };

      dbUpdateReturningMock.mockResolvedValueOnce([updatedItem]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.updateItemAgent({
        itemId: ITEM_ID,
        agentType: "opencode",
      });

      expect(dbUpdateMock).toHaveBeenCalledWith(dispatchItems);
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ agentType: "opencode" });
      expect(result).toMatchObject({ agentType: "opencode" });
    });

    it("throws NOT_FOUND when item does not exist", async () => {
      dbUpdateReturningMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.dispatch.updateItemAgent({
          itemId: ITEM_ID,
          agentType: "opencode",
        }),
      ).rejects.toThrow("Dispatch item not found");
    });
  });

  describe("updateConcurrency", () => {
    it("changes concurrency limit", async () => {
      const updatedBatch = {
        id: BATCH_ID,
        concurrency: 5,
      };

      dbUpdateReturningMock.mockResolvedValueOnce([updatedBatch]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.updateConcurrency({
        batchId: BATCH_ID,
        concurrency: 5,
      });

      expect(dbUpdateMock).toHaveBeenCalledWith(dispatchBatches);
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ concurrency: 5 });
      expect(result).toMatchObject({ concurrency: 5 });
    });

    it("throws NOT_FOUND when batch does not exist", async () => {
      dbUpdateReturningMock.mockResolvedValueOnce([]);

      const caller = createCaller({ id: "user-1" });

      await expect(
        caller.dispatch.updateConcurrency({
          batchId: BATCH_ID,
          concurrency: 5,
        }),
      ).rejects.toThrow("Batch not found");
    });
  });

  describe("checkProgress", () => {
    it("marks items completed when taskRun is completed", async () => {
      const batch = {
        id: BATCH_ID,
        userId: "user-1",
        status: "running",
        concurrency: 2,
        totalTasks: 1,
        completedTasks: 0,
        failedTasks: 0,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      };

      const runningItem = {
        id: ITEM_ID,
        batchId: BATCH_ID,
        planningTaskId: "task-1",
        planningTaskIdentifier: "TSK-1",
        title: "Task A",
        agentType: "claude",
        status: "running",
        taskRunId: TASK_RUN_ID,
        blockedByItems: [],
        pipelineState: null,
        sortOrder: 0,
      };

      const completedItem = { ...runningItem, status: "completed", pipelineState: "agent_complete" };

      // findFirst: batch
      dbQueryFindFirstMock
        .mockResolvedValueOnce(batch)
        // final batch re-fetch
        .mockResolvedValueOnce({ ...batch, completedTasks: 1, status: "completed" });

      // findMany calls in order:
      dbQueryFindManyMock
        // 1. dispatchItems.findMany (initial items)
        .mockResolvedValueOnce([runningItem])
        // 2. taskRuns.findMany (check running items)
        .mockResolvedValueOnce([{ id: TASK_RUN_ID, status: "completed" }])
        // 3. dispatchItems.findMany (after update - for dependency check)
        .mockResolvedValueOnce([completedItem])
        // 4. dispatchItems.findMany (after unblocking)
        .mockResolvedValueOnce([completedItem])
        // 5. dispatchItems.findMany (final items)
        .mockResolvedValueOnce([completedItem])
        // 6. dispatchItems.findMany (pipeline items re-fetch)
        .mockResolvedValueOnce([completedItem]);

      // update calls: item status → completed, batch counters, batch completed, notification
      dbUpdateMock.mockReturnValue({
        set: (v: unknown) => {
          dbUpdateSetMock(v);
          return {
            where: () => {
              return { returning: () => Promise.resolve([]) };
            },
          };
        },
      });

      // Insert notification
      dbInsertReturningMock.mockResolvedValue([{ id: "notif-1" }]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.checkProgress({
        batchId: BATCH_ID,
      });

      // Verify the update was called with completed status
      expect(dbUpdateSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", pipelineState: "agent_complete" }),
      );

      // Verify notification was inserted
      expect(dbInsertMock).toHaveBeenCalledWith(notifications);
    });

    it("unblocks dependent items when blockers complete", async () => {
      const batch = {
        id: BATCH_ID,
        userId: "user-1",
        status: "running",
        concurrency: 2,
        totalTasks: 2,
        completedTasks: 0,
        failedTasks: 0,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      };

      const completedItem = {
        id: ITEM_ID,
        batchId: BATCH_ID,
        planningTaskId: "task-1",
        planningTaskIdentifier: "TSK-1",
        title: "Task A",
        status: "completed",
        taskRunId: TASK_RUN_ID,
        blockedByItems: [],
        pipelineState: "agent_complete",
        sortOrder: 0,
        agentType: "claude",
      };

      const blockedItem = {
        id: ITEM_ID_2,
        batchId: BATCH_ID,
        planningTaskId: "task-2",
        planningTaskIdentifier: "TSK-2",
        title: "Task B",
        status: "blocked",
        taskRunId: null,
        blockedByItems: [ITEM_ID], // blocked by item 1
        pipelineState: null,
        sortOrder: 1,
        agentType: "claude",
      };

      const unblockedItem = { ...blockedItem, status: "queued" };

      dbQueryFindFirstMock
        .mockResolvedValueOnce(batch) // batch
        .mockResolvedValueOnce({ ...batch, status: "running" }); // final batch re-fetch

      dbQueryFindManyMock
        // 1. initial items
        .mockResolvedValueOnce([completedItem, blockedItem])
        // 2. taskRuns (no running items to check)
        // skipped because runningItems.length === 0
        // 3. items after update (for dependency check) — item1 completed, item2 still blocked
        .mockResolvedValueOnce([completedItem, blockedItem])
        // 4. items after unblocking
        .mockResolvedValueOnce([completedItem, unblockedItem])
        // 5. final items
        .mockResolvedValueOnce([completedItem, unblockedItem])
        // 6. pipeline items
        .mockResolvedValueOnce([completedItem, unblockedItem]);

      // Mock update for unblocking and batch counters
      dbUpdateMock.mockReturnValue({
        set: (v: unknown) => {
          dbUpdateSetMock(v);
          return {
            where: () => ({ returning: () => Promise.resolve([]) }),
          };
        },
      });

      dbInsertReturningMock.mockResolvedValue([{ id: "notif-1" }]);

      const caller = createCaller({ id: "user-1" });

      const result = await caller.dispatch.checkProgress({
        batchId: BATCH_ID,
      });

      // Verify unblocking: status was set to "queued" for the blocked item
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ status: "queued" });
    });
  });
});
