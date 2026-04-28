import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeGraphEventReporter } from "../eventReporter";

// Mocks for DB operations
const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();
const dbInsertOnConflictMock = vi.fn();

const dbQueryFindFirstMock = vi.fn();

const makeDbMock = () => ({
  insert: (table: unknown) => {
    dbInsertMock(table);
    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);
        return {
          returning: () => dbInsertReturningMock(),
          onConflictDoUpdate: (opts: unknown) => {
            dbInsertOnConflictMock(opts);
            return {
              returning: () => dbInsertReturningMock(),
            };
          },
        };
      },
    };
  },
  query: {
    taskRuns: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("taskRuns", ...args),
    },
    forgeRevisions: {
      findFirst: (...args: unknown[]) => dbQueryFindFirstMock("forgeRevisions", ...args),
    },
  },
});

const TASK_RUN_ID = "5e6f7a8b-9c0d-4e1f-2a3b-4c5d6e7f8a9b";
const REPO_ID = "repo-001";
const REVISION_ID = "rev-001";
const WORK_ITEM_ID = "wi-001";

describe("ForgeGraphEventReporter", () => {
  let db: ReturnType<typeof makeDbMock>;
  let reporter: ForgeGraphEventReporter;

  beforeEach(() => {
    db = makeDbMock();
    reporter = new ForgeGraphEventReporter(db as any);
    dbInsertMock.mockReset();
    dbInsertValuesMock.mockReset();
    dbInsertReturningMock.mockReset();
    dbInsertOnConflictMock.mockReset();
    dbQueryFindFirstMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("reportCreated", () => {
    it("inserts revision + run event", async () => {
      const revision = { id: REVISION_ID, repoId: REPO_ID };

      // insert forgeRevisions → onConflictDoUpdate → returning
      dbInsertReturningMock.mockResolvedValueOnce([revision]);

      // insert forgeRunEvents → values (no returning needed, but mock it)
      dbInsertReturningMock.mockResolvedValueOnce(undefined);

      // Provide a mock for the second insert (forgeRunEvents) that doesn't use onConflictDoUpdate
      // The second insert goes through insert().values() directly — we need it to resolve
      // Actually both inserts go through the same mock chain. Let's trace the flow:
      // 1. insert(forgeRevisions).values(...).onConflictDoUpdate(...).returning()
      // 2. insert(forgeRunEvents).values(...)  — but this has no .returning(), just awaits

      await reporter.reportCreated({
        id: TASK_RUN_ID,
        repositoryId: REPO_ID,
        branch: "feature/login",
        planningItemId: "plan-1",
        workItemId: WORK_ITEM_ID,
      });

      // First insert: forgeRevisions
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: REPO_ID,
          revId: "feature/login",
          taskRunId: TASK_RUN_ID,
          branch: "feature/login",
        }),
      );

      // Second insert: forgeRunEvents
      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: TASK_RUN_ID,
          repoId: REPO_ID,
          revisionId: REVISION_ID,
          eventType: "created",
        }),
      );
    });

    it("returns silently when repositoryId is null", async () => {
      await reporter.reportCreated({
        id: TASK_RUN_ID,
        repositoryId: null,
        branch: null,
        planningItemId: "plan-1",
      });

      // No DB calls should happen
      expect(dbInsertMock).not.toHaveBeenCalled();
    });
  });

  describe("reportApproved", () => {
    it("inserts 'approved' event", async () => {
      // taskRuns.findFirst → run with repositoryId
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: TASK_RUN_ID,
        repositoryId: REPO_ID,
        workItemId: WORK_ITEM_ID,
      });

      // forgeRevisions.findFirst → revision
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: REVISION_ID,
        repoId: REPO_ID,
      });

      await reporter.reportApproved(TASK_RUN_ID);

      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: TASK_RUN_ID,
          repoId: REPO_ID,
          revisionId: REVISION_ID,
          eventType: "approved",
        }),
      );
    });
  });

  describe("reportFailed", () => {
    it("inserts 'failed' event", async () => {
      // taskRuns.findFirst
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: TASK_RUN_ID,
        repositoryId: REPO_ID,
        workItemId: null,
      });

      // forgeRevisions.findFirst
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: REVISION_ID,
        repoId: REPO_ID,
      });

      await reporter.reportFailed(TASK_RUN_ID);

      expect(dbInsertValuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: TASK_RUN_ID,
          eventType: "failed",
        }),
      );
    });

    it("silently returns when task run has no repositoryId", async () => {
      dbQueryFindFirstMock.mockResolvedValueOnce({
        id: TASK_RUN_ID,
        repositoryId: null,
      });

      await reporter.reportFailed(TASK_RUN_ID);

      // Only the findFirst for taskRuns should have been called
      expect(dbQueryFindFirstMock).toHaveBeenCalledTimes(1);
      expect(dbInsertMock).not.toHaveBeenCalled();
    });
  });
});
