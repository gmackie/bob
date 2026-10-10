import { describe, expect, it } from "vitest";

import {
  buildCreateBatchInput,
  buildPlanExecutionView,
  findBatchForPlanningSession,
  formatPlanWatchTitle,
  getPlanExecutionLayout,
  getPlanPanelMode,
  parseBatchList,
  parseCommitPlanResult,
  parseCommittedPlanTasks,
  parseDispatchBatch,
  parsePlanningDrafts,
  resolveWatchSessionId,
  shouldPollBatchProgress,
} from "./plan-execution";

const sessionDetail = {
  drafts: [
    {
      id: "draft-1",
      title: "Add the task panel",
      description: "Show drafts on the phone.",
      kind: "feature",
      priority: "high",
      status: "draft",
    },
    {
      id: "draft-2",
      title: "Watch the run",
      description: null,
      kind: "task",
      priority: "no_priority",
      status: "draft",
    },
    {
      id: "draft-3",
      title: "Already created",
      kind: "task",
      priority: "low",
      status: "committed",
    },
  ],
  dependencies: [{ draftId: "draft-2", dependsOnDraftId: "draft-1" }],
};

describe("mobile plan execution", () => {
  it("uses a side column on iPad widths and a bar on the phone", () => {
    expect(getPlanExecutionLayout(390)).toBe("stack");
    expect(getPlanExecutionLayout(834)).toBe("stack");
    expect(getPlanExecutionLayout(1180)).toBe("split");
    expect(getPlanPanelMode("stack", false)).toBe("bar");
    expect(getPlanPanelMode("stack", true)).toBe("expanded");
    expect(getPlanPanelMode("split", false)).toBe("column");
  });

  it("keeps only uncommitted drafts and names their blockers", () => {
    expect(parsePlanningDrafts(sessionDetail)).toEqual([
      {
        id: "draft-1",
        title: "Add the task panel",
        description: "Show drafts on the phone.",
        meta: "Feature · High",
        blockedBy: [],
      },
      {
        id: "draft-2",
        title: "Watch the run",
        description: null,
        meta: "Task",
        blockedBy: ["Add the task panel"],
      },
    ]);
  });

  it("turns a commit result into the dispatch batch request", () => {
    const committed = parseCommitPlanResult({
      committed: 1,
      tasks: [
        { draftId: "draft-1", taskId: "task-1", identifier: "BOB-12" },
        { draftId: "", taskId: "task-2", identifier: "BOB-13" },
      ],
    });

    expect(committed).toEqual({
      committed: 1,
      tasks: [{ draftId: "draft-1", taskId: "task-1", identifier: "BOB-12" }],
    });
    expect(buildCreateBatchInput("session-1", committed?.tasks ?? [])).toEqual({
      sessionId: "session-1",
      concurrency: 2,
      tasks: [{ draftId: "draft-1", taskId: "task-1", identifier: "BOB-12" }],
    });
  });

  it("finds the batch created from this planning session", () => {
    const batches = parseBatchList([
      { id: "batch-new", sessionId: "session-1" },
      { id: "batch-old", sessionId: "session-2" },
      { id: "batch-blank" },
    ]);

    expect(findBatchForPlanningSession(batches, "session-1")?.id).toBe("batch-new");
    expect(findBatchForPlanningSession(batches, "missing")).toBeNull();
  });

  it("links a running task to its execution session", () => {
    const batch = parseDispatchBatch(
      {
        batch: {
          id: "batch-1",
          status: "running",
          totalTasks: 2,
          completedTasks: 0,
          failedTasks: 0,
        },
        items: [
          {
            id: "item-1",
            title: "Add the task panel",
            planningTaskIdentifier: "BOB-12",
            planningTaskId: "work-1",
            status: "running",
            sessionId: "run-1",
          },
          {
            id: "item-2",
            title: "Watch the run",
            planningTaskIdentifier: "BOB-13",
            planningTaskId: "work-2",
            status: "blocked",
          },
        ],
      },
      [
        { sessionId: "plan-1", workItemId: null },
        { sessionId: "run-2", workItemId: "work-2" },
      ],
      "plan-1",
    );

    expect(batch?.progressLabel).toBe("2 tasks · 1 running · 1 waiting");
    expect(batch?.items.map((item) => item.watchSessionId)).toEqual(["run-1", "run-2"]);
    expect(shouldPollBatchProgress(batch?.status)).toBe(true);
    expect(shouldPollBatchProgress("pending")).toBe(false);
  });

  it("does not treat the planning session as the run to watch", () => {
    expect(
      resolveWatchSessionId({
        itemSessionId: "plan-1",
        planningTaskId: "work-1",
        workItemId: null,
        planningSessionId: "plan-1",
        sessions: [{ sessionId: "plan-1", workItemId: "work-1" }],
      }),
    ).toBeNull();
  });

  it("names the run being watched from the plan", () => {
    expect(
      formatPlanWatchTitle({ identifier: "BOB-12", title: "Add the task panel" }),
    ).toBe("BOB-12 · Add the task panel");
    expect(formatPlanWatchTitle({ identifier: "", title: "Add the task panel" })).toBe(
      "Add the task panel",
    );
    expect(formatPlanWatchTitle({ identifier: "  ", title: "  " })).toBe("Run");
  });

  it("shows filed issues as ready to run", () => {
    const detail = {
      drafts: [
        {
          id: "draft-1",
          title: "Add the task panel",
          status: "committed",
          planningTaskId: "issue-1",
          planningTaskIdentifier: "BOB-12",
          workItemId: "work-1",
        },
        {
          id: "draft-2",
          title: "Still a draft",
          status: "draft",
          planningTaskIdentifier: "BOB-13",
        },
      ],
    };

    expect(parseCommittedPlanTasks(detail)).toEqual([
      {
        draftId: "draft-1",
        taskId: "work-1",
        identifier: "BOB-12",
        title: "Add the task panel",
      },
    ]);
    expect(
      buildPlanExecutionView({
        isLoading: false,
        loadError: null,
        actionError: null,
        drafts: [],
        readyTasks: parseCommittedPlanTasks(detail),
        batch: null,
        isCreating: false,
        isRunning: false,
      }),
    ).toMatchObject({
      phase: "ready",
      detail: "1 task ready",
      primaryAction: { key: "run", label: "Run in Bob", disabled: false },
    });
  });

  it("offers create, then run, and stays quiet when there is nothing to do", () => {
    const drafts = parsePlanningDrafts(sessionDetail);

    expect(
      buildPlanExecutionView({
        isLoading: false,
        loadError: null,
        actionError: null,
        drafts,
        batch: null,
        isCreating: false,
        isRunning: false,
      }).primaryAction,
    ).toEqual({ key: "create", label: "Create tasks", disabled: false });

    const batch = parseDispatchBatch({
      batch: { id: "batch-1", status: "pending", totalTasks: 1, completedTasks: 0, failedTasks: 0 },
      items: [
        {
          id: "item-1",
          title: "Add the task panel",
          planningTaskIdentifier: "BOB-12",
          planningTaskId: "work-1",
          status: "queued",
        },
      ],
    });

    expect(
      buildPlanExecutionView({
        isLoading: false,
        loadError: null,
        actionError: null,
        drafts,
        batch,
        isCreating: false,
        isRunning: true,
      }),
    ).toMatchObject({
      phase: "batch",
      primaryAction: { key: "run", label: "Starting...", disabled: true },
    });

    expect(
      buildPlanExecutionView({
        isLoading: false,
        loadError: null,
        actionError: "The board rejected the task.",
        drafts: [],
        batch: null,
        isCreating: false,
        isRunning: false,
      }),
    ).toMatchObject({
      phase: "empty",
      detail: "Bob adds tasks here as the plan takes shape.",
      error: "The board rejected the task.",
    });
  });
});
