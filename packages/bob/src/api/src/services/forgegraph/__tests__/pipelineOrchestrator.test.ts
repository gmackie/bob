import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@bob/db/client", () => ({
  db: {},
}));

import {
  advancePipeline,
  handleDeliveryEvidence,
  reopenPipeline,
} from "../pipelineOrchestrator";
import type { Db } from "@bob/db/client";

// Mocks for DB operations
const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertOnConflictMock = vi.fn();

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();

const dbQueryFindFirstMock = vi.fn<(table: string, ...args: unknown[]) => unknown>();

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
    dispatchItems: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("dispatchItems", ...args),
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
  let db: Db;

  beforeEach(() => {
    db = makeDbMock() as unknown as Db;
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

      await advancePipeline(db, item, makeBatch());

      // Should transition to "awaiting_review" (no build yet)
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "awaiting_review" });
      expect(dbInsertMock).not.toHaveBeenCalled();
    });

    it("no-ops when taskRunId is null", async () => {
      const item = makeItem({ pipelineState: "agent_complete", taskRunId: null });

      await advancePipeline(db, item, makeBatch());

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

      await advancePipeline(db, item, makeBatch());

      expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "building" });
    });

    it("stays in awaiting_review when no review artifact exists", async () => {
      const item = makeItem({ pipelineState: "awaiting_review" });
      dbQueryFindFirstMock.mockResolvedValueOnce(null);

      await advancePipeline(db, item, makeBatch());

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

      await advancePipeline(db, item, makeBatch());

      // Marks the review artifact as stale (isCurrent: false) but does NOT
      // transition pipeline state — it stays in awaiting_review.
      expect(dbUpdateSetMock).toHaveBeenCalledWith({ isCurrent: false });
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

      await advancePipeline(db, item, makeBatch());

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

      await advancePipeline(db, item, makeBatch());

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

      await advancePipeline(db, item, makeBatch());

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

      await advancePipeline(db, item, makeBatch());

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

        await advancePipeline(db, item, makeBatch());

        expect(dbInsertMock).not.toHaveBeenCalled();
        expect(dbUpdateMock).not.toHaveBeenCalled();
        expect(dbQueryFindFirstMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("null state", () => {
    it("no-ops for null pipeline state", async () => {
      const item = makeItem({ pipelineState: null });

      await advancePipeline(db, item, makeBatch());

      expect(dbInsertMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });
});

describe("reopenPipeline", () => {
  let db: Db;

  beforeEach(() => {
    db = makeDbMock() as unknown as Db;
    dbInsertMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbQueryFindFirstMock.mockReset();
  });

  it("reopens a terminal state item back to agent_complete", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "build_failed",
    });

    const reopened = await reopenPipeline(db, ITEM_ID, "ci_failed");

    expect(reopened).toBe(true);
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "agent_complete" });
  });

  it("reopens an advanced state item back to agent_complete", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "building",
    });

    const reopened = await reopenPipeline(db, ITEM_ID, "ci_failed");

    expect(reopened).toBe(true);
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "agent_complete" });
  });

  it("returns false for items already at agent_complete", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "agent_complete",
    });

    const reopened = await reopenPipeline(db, ITEM_ID, "ci_failed");

    expect(reopened).toBe(false);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("returns false for items with null state", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: null,
    });

    const reopened = await reopenPipeline(db, ITEM_ID, "ci_failed");

    expect(reopened).toBe(false);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("returns false when item not found", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce(null);

    const reopened = await reopenPipeline(db, "nonexistent", "ci_failed");

    expect(reopened).toBe(false);
  });
});

describe("handleDeliveryEvidence", () => {
  let db: Db;
  const dbUpdateReturningMock = vi.fn<() => Promise<Record<string, unknown>[]>>();

  beforeEach(() => {
    // Extend the base mock to support .returning() on update, built before
    // the cast to `Db` so this stays a plain object assignment rather than
    // mutating a value already typed with the strict Db interface.
    const baseDb = makeDbMock();
    const dbWithUpdateReturning = {
      ...baseDb,
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
    };
    db = dbWithUpdateReturning as unknown as Db;
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbUpdateMock.mockReset();
    dbUpdateSetMock.mockReset();
    dbUpdateWhereMock.mockReset();
    dbUpdateReturningMock.mockReset();
    dbQueryFindFirstMock.mockReset();
  });

  it("reopens work item and pipeline on ci_failed", async () => {
    // reopenPipeline: findFirst returns an advanced-state item
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "building",
    });
    // update work item .returning()
    dbUpdateReturningMock.mockResolvedValueOnce([{ id: "task-1", status: "in_progress" }]);

    await handleDeliveryEvidence(db, {
      dispatchItemId: ITEM_ID,
      workItemId: "task-1",
      taskRunId: TASK_RUN_ID,
      evidenceType: "ci_failed",
    });

    // Should update work item status to in_progress
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ status: "in_progress" });
    // Should reopen pipeline (sets pipelineState to agent_complete)
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "agent_complete" });
    // Should log audit event
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: TASK_RUN_ID,
        workItemId: "task-1",
        eventType: "ci_failed",
        phase: "execute",
      }),
    );
  });

  it("sets work item to done on deploy_succeeded", async () => {
    // update work item .returning()
    dbUpdateReturningMock.mockResolvedValueOnce([{ id: "task-1", status: "done" }]);

    await handleDeliveryEvidence(db, {
      dispatchItemId: ITEM_ID,
      workItemId: "task-1",
      taskRunId: TASK_RUN_ID,
      evidenceType: "deploy_succeeded",
    });

    expect(dbUpdateSetMock).toHaveBeenCalledWith({ status: "done" });
    // Should NOT reopen pipeline
    expect(dbUpdateSetMock).not.toHaveBeenCalledWith({ pipelineState: "agent_complete" });
  });

  it("reopens work item and pipeline on review_rejected", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "awaiting_review",
    });
    dbUpdateReturningMock.mockResolvedValueOnce([{ id: "task-1", status: "in_progress" }]);

    await handleDeliveryEvidence(db, {
      dispatchItemId: ITEM_ID,
      workItemId: "task-1",
      taskRunId: TASK_RUN_ID,
      evidenceType: "review_rejected",
    });

    expect(dbUpdateSetMock).toHaveBeenCalledWith({ status: "in_progress" });
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "agent_complete" });
  });

  it("reopens work item and pipeline on deploy_failed", async () => {
    dbQueryFindFirstMock.mockResolvedValueOnce({
      id: ITEM_ID,
      pipelineState: "deploying_dev",
    });
    dbUpdateReturningMock.mockResolvedValueOnce([{ id: "task-1", status: "in_progress" }]);

    await handleDeliveryEvidence(db, {
      dispatchItemId: ITEM_ID,
      workItemId: "task-1",
      taskRunId: TASK_RUN_ID,
      evidenceType: "deploy_failed",
    });

    expect(dbUpdateSetMock).toHaveBeenCalledWith({ status: "in_progress" });
    expect(dbUpdateSetMock).toHaveBeenCalledWith({ pipelineState: "agent_complete" });
  });

  it("does not change work item status on ci_passed", async () => {
    await handleDeliveryEvidence(db, {
      dispatchItemId: ITEM_ID,
      workItemId: "task-1",
      taskRunId: TASK_RUN_ID,
      evidenceType: "ci_passed",
    });

    // Should NOT update work item status
    // vitest's expect.any/objectContaining always return `any` per their own
    // type declarations, regardless of generic argument.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(dbUpdateSetMock).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.any(String) }));
    // Should still log audit event
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ci_passed",
      }),
    );
  });
});
