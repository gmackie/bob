import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateIssue = vi.fn();
const mockIssue = vi.fn();
const mockIssues = vi.fn();
const mockUpdateIssue = vi.fn();
const mockCreateComment = vi.fn();
const mockIssueSearch = vi.fn();
const mockTeam = vi.fn();

vi.mock("@linear/sdk", () => {
  const MockLinearClient = function (this: any) {
    this.createIssue = mockCreateIssue;
    this.issue = mockIssue;
    this.issues = mockIssues;
    this.updateIssue = mockUpdateIssue;
    this.createComment = mockCreateComment;
    this.issueSearch = mockIssueSearch;
    this.team = mockTeam;
  } as any;
  return { LinearClient: MockLinearClient };
});

vi.mock("@bob/db", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@bob/db/schema", () => ({
  taskRuns: {
    id: "taskRuns.id",
    workItemId: "taskRuns.workItemId",
    syncFailures: "taskRuns.syncFailures",
  },
  workItemArtifacts: {
    id: "workItemArtifacts.id",
  },
}));

import { LinearPlanningProvider } from "../linearProvider.js";
import { PlanningProviderError } from "../planningProvider.js";

describe("LinearPlanningProvider", () => {
  let provider: LinearPlanningProvider;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = createMockDb();

    provider = new LinearPlanningProvider(
      mockDb,
      "lin_test_key",
      "team-1",
      "project-1",
    );
  });

  function createMockDb() {
    const mock: any = {};
    mock.select = vi.fn().mockReturnValue(mock);
    mock.from = vi.fn().mockReturnValue(mock);
    mock.where = vi.fn().mockReturnValue(mock);
    mock.then = vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
      Promise.resolve(cb([])),
    );
    mock.insert = vi.fn().mockReturnValue(mock);
    mock.values = vi.fn().mockReturnValue(mock);
    mock.returning = vi.fn().mockResolvedValue([]);
    mock.update = vi.fn().mockReturnValue(mock);
    mock.set = vi.fn().mockReturnValue(mock);
    return mock;
  }

  // ===========================================================================
  // CRUD (Tier 1)
  // ===========================================================================

  describe("createTask", () => {
    it("calls client.createIssue with correct params and maps response", async () => {
      const mockIssueData = {
        id: "issue-1",
        identifier: "ENG-42",
        title: "Test issue",
        description: "A description",
        state: { name: "Todo" },
        priority: 2,
        url: "https://linear.app/team/issue/ENG-42",
        labels: { nodes: [{ name: "bug" }] },
        assignee: { id: "user-1" },
      };

      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve(mockIssueData),
      });

      const result = await provider.createTask({
        title: "Test issue",
        description: "A description",
        providerProjectId: "project-1",
        priority: "high",
        assigneeId: "user-1",
        labels: ["label-1"],
      });

      expect(mockCreateIssue).toHaveBeenCalledWith({
        teamId: "team-1",
        title: "Test issue",
        description: "A description",
        projectId: "project-1",
        priority: 2,
        assigneeId: "user-1",
        labelIds: ["label-1"],
      });

      expect(result).toEqual({
        externalId: "issue-1",
        identifier: "ENG-42",
        title: "Test issue",
        description: "A description",
        status: "Todo",
        priority: "high",
        url: "https://linear.app/team/issue/ENG-42",
        labels: ["bug"],
        assigneeId: "user-1",
      });
    });

    it("throws PlanningProviderError when createIssue returns no issue", async () => {
      mockCreateIssue.mockResolvedValue({
        issue: Promise.resolve(null),
      });

      await expect(
        provider.createTask({
          title: "Test",
          description: null,
          providerProjectId: "project-1",
        }),
      ).rejects.toThrow(PlanningProviderError);
    });
  });

  describe("getTask", () => {
    it("calls client.issue and maps response", async () => {
      const mockIssueData = {
        id: "issue-1",
        identifier: "ENG-42",
        title: "Test issue",
        description: null,
        state: { name: "In Progress" },
        priority: 3,
        url: "https://linear.app/team/issue/ENG-42",
        labels: { nodes: [] },
        assignee: null,
      };

      mockIssue.mockResolvedValue(mockIssueData);

      const result = await provider.getTask("issue-1");

      expect(mockIssue).toHaveBeenCalledWith("issue-1");
      expect(result).toEqual({
        externalId: "issue-1",
        identifier: "ENG-42",
        title: "Test issue",
        description: null,
        status: "In Progress",
        priority: "medium",
        url: "https://linear.app/team/issue/ENG-42",
        labels: [],
        assigneeId: null,
      });
    });

    it("returns null when issue not found", async () => {
      mockIssue.mockRejectedValue(new Error("Entity not found"));

      const result = await provider.getTask("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("updateTask", () => {
    it("calls client.updateIssue then re-fetches", async () => {
      const mockIssueData = {
        id: "issue-1",
        identifier: "ENG-42",
        title: "Updated title",
        description: "New desc",
        state: { name: "In Progress" },
        priority: 1,
        url: "https://linear.app/team/issue/ENG-42",
        labels: { nodes: [] },
        assignee: null,
      };

      mockUpdateIssue.mockResolvedValue({ success: true });
      mockIssue.mockResolvedValue(mockIssueData);

      const result = await provider.updateTask("issue-1", {
        title: "Updated title",
        description: "New desc",
        priority: "urgent",
      });

      expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
        title: "Updated title",
        description: "New desc",
        priority: 1,
      });
      expect(mockIssue).toHaveBeenCalledWith("issue-1");
      expect(result.title).toBe("Updated title");
    });
  });

  describe("listTasks", () => {
    it("calls client.issues with filter", async () => {
      const mockIssueData = {
        id: "issue-1",
        identifier: "ENG-42",
        title: "Test",
        description: null,
        state: { name: "Todo" },
        priority: 4,
        url: null,
        labels: { nodes: [] },
        assignee: null,
      };

      mockIssues.mockResolvedValue({ nodes: [mockIssueData] });

      const result = await provider.listTasks({
        providerProjectId: "proj-1",
        assigneeId: "user-1",
        limit: 10,
      });

      expect(mockIssues).toHaveBeenCalledWith({
        first: 10,
        filter: {
          team: { id: { eq: "team-1" } },
          project: { id: { eq: "proj-1" } },
          assignee: { id: { eq: "user-1" } },
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.externalId).toBe("issue-1");
    });
  });

  // ===========================================================================
  // Lifecycle (Tier 2)
  // ===========================================================================

  describe("reportMilestone", () => {
    it("posts a comment and does not throw on failure", async () => {
      mockCreateComment.mockRejectedValue(new Error("Network error"));

      // Set up DB to return task run for sync_failures recording
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ syncFailures: [] }])),
      );
      mockDb.set.mockReturnValue(mockDb);
      mockDb.where.mockResolvedValue(undefined);

      // Should NOT throw
      await expect(
        provider.reportMilestone("issue-1", "run-1", {
          title: "Checkpoint",
          body: "Work done",
        }),
      ).resolves.toBeUndefined();
    });

    it("records sync failure in task_runs when comment fails", async () => {
      mockCreateComment.mockRejectedValue(new Error("API timeout"));

      // The lifecycleWithFallback does:
      //   1. db.select(...).from(taskRuns).where(...).then(cb) to get existing syncFailures
      //   2. db.update(taskRuns).set({...}).where(...)
      // We need a fresh db mock that tracks both paths.
      const setMock = vi.fn();
      const updateWhereMock = vi.fn().mockResolvedValue(undefined);

      const lifecycleDb: any = {};
      lifecycleDb.select = vi.fn().mockReturnValue(lifecycleDb);
      lifecycleDb.from = vi.fn().mockReturnValue(lifecycleDb);
      lifecycleDb.where = vi.fn().mockReturnValue(lifecycleDb);
      lifecycleDb.then = vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ syncFailures: [] }])),
      );
      lifecycleDb.update = vi.fn().mockReturnValue({
        set: setMock.mockReturnValue({
          where: updateWhereMock,
        }),
      });
      lifecycleDb.insert = vi.fn().mockReturnValue(lifecycleDb);
      lifecycleDb.values = vi.fn().mockResolvedValue(undefined);

      // Recreate provider with the lifecycle-specific mock db
      const testProvider = new LinearPlanningProvider(
        lifecycleDb,
        "lin_test_key",
        "team-1",
        "project-1",
      );

      await testProvider.reportMilestone("issue-1", "run-1", {
        title: "Checkpoint",
        body: "Work done",
      });

      expect(lifecycleDb.update).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          syncFailures: expect.arrayContaining([
            expect.objectContaining({
              method: "reportMilestone",
              error: "API timeout",
            }),
          ]),
        }),
      );
    });
  });

  describe("setStatus", () => {
    it("posts comment for blocked status instead of changing state", async () => {
      mockCreateComment.mockResolvedValue({ id: "comment-1" });

      // Set up DB mock for findWorkItemIdFromTaskRun (not needed here but the lifecycle wrapper might read)
      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );

      await provider.setStatus("issue-1", "run-1", "blocked");

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: expect.stringContaining("Task blocked"),
      });
      expect(mockUpdateIssue).not.toHaveBeenCalled();
    });

    it("posts comment for failed status instead of changing state", async () => {
      mockCreateComment.mockResolvedValue({ id: "comment-1" });

      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );

      await provider.setStatus("issue-1", "run-1", "failed");

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: expect.stringContaining("Task failed"),
      });
      expect(mockUpdateIssue).not.toHaveBeenCalled();
    });

    it("resolves linear state and updates issue for started", async () => {
      mockTeam.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: "state-in-progress", name: "In Progress" },
            { id: "state-done", name: "Done" },
          ],
        }),
      });
      mockUpdateIssue.mockResolvedValue({ success: true });

      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );

      await provider.setStatus("issue-1", "run-1", "started");

      expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
        stateId: "state-in-progress",
      });
    });
  });

  describe("comment formatting", () => {
    it("includes bot prefix and taskRunId footer", async () => {
      mockCreateComment.mockResolvedValue({ id: "comment-1" });

      mockDb.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
        Promise.resolve(cb([{ workItemId: "wi-1" }])),
      );

      await provider.addComment("issue-1", "run-abc-123", "Some note");

      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: expect.stringMatching(/\*\*🤖 Bob — Note\*\*/),
      });
      expect(mockCreateComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: expect.stringContaining("`run-abc-123`"),
      });
    });
  });
});
