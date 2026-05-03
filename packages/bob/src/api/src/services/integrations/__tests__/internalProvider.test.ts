import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@bob/db", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => ({ desc: col })),
}));

vi.mock("@bob/db/schema", () => ({
  workItems: {
    id: "workItems.id",
    projectId: "workItems.projectId",
    status: "workItems.status",
    assigneeUserId: "workItems.assigneeUserId",
    kind: "workItems.kind",
    createdAt: "workItems.createdAt",
  },
  workItemArtifacts: {
    id: "workItemArtifacts.id",
  },
  taskRuns: {
    id: "taskRuns.id",
    workItemId: "taskRuns.workItemId",
  },
}));

import { InternalPlanningProvider } from "../internalProvider.js";
import { PlanningProviderError } from "../planningProvider.js";

describe("InternalPlanningProvider", () => {
  let provider: InternalPlanningProvider;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    provider = new InternalPlanningProvider(mockDb);
  });

  function createMockDb() {
    const mock: any = {};
    mock.insert = vi.fn().mockReturnValue(mock);
    mock.values = vi.fn().mockReturnValue(mock);
    mock.returning = vi.fn().mockResolvedValue([]);
    mock.select = vi.fn().mockReturnValue(mock);
    mock.from = vi.fn().mockReturnValue(mock);
    mock.where = vi.fn().mockReturnValue(mock);
    mock.orderBy = vi.fn().mockReturnValue(mock);
    mock.limit = vi.fn().mockResolvedValue([]);
    mock.update = vi.fn().mockReturnValue(mock);
    mock.set = vi.fn().mockReturnValue(mock);
    mock.then = vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
      Promise.resolve(cb([])),
    );
    return mock;
  }

  // ===========================================================================
  // CRUD (Tier 1)
  // ===========================================================================

  describe("createTask", () => {
    it("inserts into workItems and returns mapped ProviderTask", async () => {
      const createdItem = {
        id: "wi-1",
        title: "New task",
        description: "Task description",
        status: "draft",
        assigneeUserId: null,
      };

      mockDb.returning.mockResolvedValue([createdItem]);

      const result = await provider.createTask({
        title: "New task",
        description: "Task description",
        providerProjectId: "proj-1",
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith({
        ownerUserId: "system",
        workspaceId: "proj-1",
        projectId: "proj-1",
        kind: "task",
        title: "New task",
        description: "Task description",
        status: "draft",
      });

      expect(result).toEqual({
        externalId: "wi-1",
        identifier: "wi-1",
        title: "New task",
        description: "Task description",
        status: "draft",
        priority: "no_priority",
        url: null,
        labels: [],
        assigneeId: null,
      });
    });

    it("throws PlanningProviderError when insert returns empty", async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(
        provider.createTask({
          title: "Test",
          description: null,
          providerProjectId: "proj-1",
        }),
      ).rejects.toThrow(PlanningProviderError);
    });
  });

  describe("getTask", () => {
    it("selects from workItems by id", async () => {
      const item = {
        id: "wi-1",
        title: "Found task",
        description: "desc",
        status: "in_progress",
        assigneeUserId: "user-1",
      };

      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([item])),
      );

      const result = await provider.getTask("wi-1");

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(result).toEqual({
        externalId: "wi-1",
        identifier: "wi-1",
        title: "Found task",
        description: "desc",
        status: "in_progress",
        priority: "no_priority",
        url: null,
        labels: [],
        assigneeId: "user-1",
      });
    });

    it("returns null when not found", async () => {
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([])),
      );

      const result = await provider.getTask("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listTasks", () => {
    it("applies filters correctly and returns mapped tasks", async () => {
      const items = [
        {
          id: "wi-1",
          title: "Task 1",
          description: null,
          status: "draft",
          assigneeUserId: "user-1",
        },
        {
          id: "wi-2",
          title: "Task 2",
          description: "Desc",
          status: "in_progress",
          assigneeUserId: null,
        },
      ];

      mockDb.limit.mockResolvedValue(items);

      const result = await provider.listTasks({
        providerProjectId: "proj-1",
        status: "draft",
        assigneeId: "user-1",
        limit: 25,
      });

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
      expect(mockDb.orderBy).toHaveBeenCalled();
      expect(mockDb.limit).toHaveBeenCalledWith(25);
      expect(result).toHaveLength(2);
      expect(result[0]!.externalId).toBe("wi-1");
      expect(result[1]!.externalId).toBe("wi-2");
    });

    it("uses default limit of 50 when not specified", async () => {
      mockDb.limit.mockResolvedValue([]);

      await provider.listTasks({});

      expect(mockDb.limit).toHaveBeenCalledWith(50);
    });
  });

  describe("updateTask", () => {
    it("updates and re-reads the work item", async () => {
      const updatedItem = {
        id: "wi-1",
        title: "Updated title",
        description: "New desc",
        status: "in_progress",
        assigneeUserId: "user-2",
      };

      // The update call chain ends with where() which needs to resolve
      // Then the re-read select chain needs then()
      let callCount = 0;
      mockDb.where.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // This is the update().set().where() — resolves as void
          return Promise.resolve();
        }
        // This is the select().from().where() for re-read — return mock for .then()
        return {
          then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
            Promise.resolve(cb([updatedItem])),
          ),
        };
      });

      const result = await provider.updateTask("wi-1", {
        title: "Updated title",
        description: "New desc",
        assigneeId: "user-2",
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({
        title: "Updated title",
        description: "New desc",
        assigneeUserId: "user-2",
      });
      expect(result.title).toBe("Updated title");
      expect(result.assigneeId).toBe("user-2");
    });

    it("throws PlanningProviderError when item not found after update", async () => {
      let callCount = 0;
      mockDb.where.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve();
        }
        return {
          then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
            Promise.resolve(cb([])),
          ),
        };
      });

      await expect(
        provider.updateTask("wi-missing", { title: "New title" }),
      ).rejects.toThrow(PlanningProviderError);
    });
  });

  // ===========================================================================
  // Lifecycle (Tier 2)
  // ===========================================================================

  describe("setStatus", () => {
    it("updates workItems.status with mapped value", async () => {
      mockDb.where.mockResolvedValue(undefined);

      await provider.setStatus("wi-1", "run-1", "started");

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith({ status: "in_progress" });
    });

    it("maps blocked status correctly", async () => {
      mockDb.where.mockResolvedValue(undefined);

      await provider.setStatus("wi-1", "run-1", "blocked");

      expect(mockDb.set).toHaveBeenCalledWith({ status: "blocked" });
    });

    it("maps review_ready status to in_review", async () => {
      mockDb.where.mockResolvedValue(undefined);

      await provider.setStatus("wi-1", "run-1", "review_ready");

      expect(mockDb.set).toHaveBeenCalledWith({ status: "in_review" });
    });

    it("maps completed status to done", async () => {
      mockDb.where.mockResolvedValue(undefined);

      await provider.setStatus("wi-1", "run-1", "completed");

      expect(mockDb.set).toHaveBeenCalledWith({ status: "done" });
    });
  });

  describe("attachArtifact", () => {
    it("inserts into workItemArtifacts", async () => {
      // First call: findWorkItemIdFromTaskRun
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );
      // insert chain
      mockDb.values.mockResolvedValue(undefined);

      await provider.attachArtifact("wi-1", "run-1", {
        type: "code",
        role: "implementation",
        title: "PR Link",
        url: "https://github.com/example/pr/1",
        summary: "Implementation PR",
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith({
        workItemId: "wi-1",
        taskRunId: "run-1",
        producerType: "bob",
        producerId: "run-1",
        artifactType: "code",
        artifactRole: "implementation",
        url: "https://github.com/example/pr/1",
        title: "PR Link",
        summary: "Implementation PR",
        content: undefined,
      });
    });
  });

  describe("reportMilestone", () => {
    it("inserts into workItemArtifacts with doc type", async () => {
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );
      mockDb.values.mockResolvedValue(undefined);

      await provider.reportMilestone("wi-1", "run-1", {
        title: "Phase 1 complete",
        body: "All tests passing",
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith({
        workItemId: "wi-1",
        taskRunId: "run-1",
        producerType: "bob",
        producerId: "run-1",
        artifactType: "doc",
        artifactRole: "documentation",
        title: "Phase 1 complete",
        content: "All tests passing",
      });
    });

    it("throws PlanningProviderError when taskRun has no workItemId", async () => {
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([])),
      );

      await expect(
        provider.reportMilestone("wi-1", "run-missing", {
          title: "Test",
          body: "Body",
        }),
      ).rejects.toThrow(PlanningProviderError);
    });
  });
});
