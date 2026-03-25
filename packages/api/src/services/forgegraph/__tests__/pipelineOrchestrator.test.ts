import { beforeEach, describe, expect, it, vi } from "vitest";

import { advancePipeline } from "../pipelineOrchestrator";

// Mocks for DB operations
const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertOnConflictMock = vi.fn();

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();

const dbQueryFindFirstMock = vi.fn();

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);
    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);
        return {
          onConflictDoNothing: (opts: unknown) => {
            dbInsertOnConflictMock(opts);
            return Promise.resolve();
          },
          returning: () => Promise.resolve([]),
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
            return Promise.resolve();
          },
        };
      },
    };
  },
  query: {
    forgeRevisions: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeRevisions", ...args),
    },
    forgeBuilds: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeBuilds", ...args),
    },
    forgeDeployments: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeDeployments", ...args),
    },
    workItemArtifacts: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("workItemArtifacts", ...args),
    },
  },
});

const ITEM_ID = "3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
const TASK_RUN_ID = "5e6f7a8b-9c0d-4e1f-2a3b-4c5d6e7f8a9b";
const REVISION_ID = "rev-001";
const BUILD_ID = "build-001";
const REPO_ID = "repo-001";

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  pipelineState: null as string | null,
  taskRunId: TASK_RUN_ID,
  planningTaskId: "task-1",
  planningTaskIdentifier: "TSK-1",
  title: "Test task",
  agentType: "claude",
  ...overrides,
});

const makeBatch = (overrides: Record<string, unknown> = {}) => ({
  id: "batch-001",
  userId: "user-1",
  ...overrides,
});

describe("advancePipeline", () => {
  let db: ReturnType<typeof makeDbMock>;

  beforeEach(() => {
    db = makeDbMock();
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertOnConflictMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbQueryFindFirstMock.mockReset();
  });

  describe("agent_complete state", () => {
    it("transitions to 'awaiting_review'", async () => {
      const item = makeItem({ pipelineState: "agent_complete" });

      await advancePipeline(db as any, item, makeBatch());

      // Should transition to "awaiting_review" (no build yet)
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "awaiting_review" });
      expect(dbInsertMock).not.toHaveBeenCalled();
    });

    it("no-ops when taskRunId is null", async () => {
      const item = makeItem({ pipelineState: "agent_complete", taskRunId: null });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbInsertMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("awaiting_review state", () => {
    it("transitions to 'building' when a code_review artifact with approve exists", async () => {
      const item = makeItem({ pipelineState: "awaiting_review" });

      // workItemArtifacts.findFirst → returns approved review
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: "artifact-1",
        artifactType: "code_review",
        isCurrent: true,
        content: JSON.stringify({ decision: "approve" }),
      });

      // forgeRevisions.findFirst → returns revision (for triggerBuild)
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: REVISION_ID,
        repoId: REPO_ID,
        taskRunId: TASK_RUN_ID,
      });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "building" });
    });

    it("stays in awaiting_review when no review artifact exists", async () => {
      const item = makeItem({ pipelineState: "awaiting_review" });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      await advancePipeline(db as any, item, makeBatch());

      expect(dbUpdateSetMock).not.toHaveBeenCalled();
    });

    it("stays in awaiting_review when review requests changes", async () => {
      const item = makeItem({ pipelineState: "awaiting_review" });

      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: "artifact-2",
        artifactType: "code_review",
        isCurrent: true,
        content: JSON.stringify({ decision: "request_changes" }),
      });

      await advancePipeline(db as any, item, makeBatch());

      // Should NOT transition — stays in awaiting_review
      expect(dbUpdateSetMock).not.toHaveBeenCalled();
    });
  });

  describe("building state", () => {
    it("transitions to 'gates_passed' when build passed", async () => {
      const item = makeItem({ pipelineState: "building" });

      // forgeBuilds.findFirst → build with passed status
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: BUILD_ID,
        revisionId: REVISION_ID,
        status: "passed",
        idempotencyKey: ITEM_ID,
      });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "gates_passed" });
    });

    it("transitions to 'build_failed' when build failed", async () => {
      const item = makeItem({ pipelineState: "building" });

      // forgeBuilds.findFirst → build with failed status
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: BUILD_ID,
        revisionId: REVISION_ID,
        status: "failed",
        idempotencyKey: ITEM_ID,
      });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "build_failed" });
      // Should also insert a failure notification
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          type: "task_completed",
        }),
      );
    });

    it("no-ops when build is still running", async () => {
      const item = makeItem({ pipelineState: "building" });

      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: BUILD_ID,
        revisionId: REVISION_ID,
        status: "running",
        idempotencyKey: ITEM_ID,
      });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("gates_passed state", () => {
    it("creates dev deployment and transitions to 'deploying_dev'", async () => {
      const item = makeItem({ pipelineState: "gates_passed" });

      // forgeBuilds.findFirst (via getRevisionAndBuild)
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: BUILD_ID,
        revisionId: REVISION_ID,
      });

      // forgeRevisions.findFirst (to get repoId)
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: REVISION_ID,
        repoId: REPO_ID,
      });

      await advancePipeline(db as any, item, makeBatch());

      // Should insert a deployment
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          revisionId: REVISION_ID,
          buildId: BUILD_ID,
          repoId: REPO_ID,
          environment: "dev",
          status: "deploying",
        }),
      );

      // Should transition to "deploying_dev"
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "deploying_dev" });
    });
  });

  describe("terminal states", () => {
    it.each(["complete", "build_failed", "deploy_failed", "review_failed"])(
      "no-ops for terminal state '%s'",
      async (state) => {
        const item = makeItem({ pipelineState: state });

        await advancePipeline(db as any, item, makeBatch());

        expect(dbInsertMock).not.toHaveBeenCalled();
        expect(dbUpdateMock).not.toHaveBeenCalled();
        expect(dbQueryFindFirstMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("null state", () => {
    it("no-ops for null pipeline state", async () => {
      const item = makeItem({ pipelineState: null });

      await advancePipeline(db as any, item, makeBatch());

      expect(dbInsertMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });
});
