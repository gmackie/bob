import { describe, expect, it } from "vitest";

import {
  buildExecutionQueue,
  buildPriorityQueueItems,
  buildPriorityQueueSaveOrder,
  buildPriorityQueueControls,
  getMobilePriorityQueueHeaderModel,
  buildQueueLanes,
  canMoveQueueItem,
  formatStatusLabel,
  getQueueItemDispatchAction,
  moveQueueItem,
  sortQueueItemsByPriority,
  unwrapWorkItemDetail,
} from "./queue";

describe("tablet execution queue", () => {
  it("keeps the mobile Priority Queue header free of explanatory copy", () => {
    expect(getMobilePriorityQueueHeaderModel()).toEqual({
      title: "Priority Queue",
      subtitle: null,
    });
  });

  it("sorts workspace work items by durable queue order", () => {
    expect(
      buildExecutionQueue([
        {
          id: "third",
          identifier: "BOB-3",
          title: "Third task",
          kind: "task",
          status: "ready",
          queueSortOrder: 2,
        },
        {
          id: "first",
          identifier: "BOB-1",
          title: "First task",
          kind: "task",
          status: "ready",
          queueSortOrder: 0,
        },
        {
          id: "second",
          identifier: "BOB-2",
          title: "Second task",
          kind: "task",
          status: "ready",
          queueSortOrder: 1,
          agentStatus: {
            sessionId: "session-2",
            status: "running",
            agentType: "claude",
          },
        },
      ]).map((item) => item.id),
    ).toEqual(["first", "second", "third"]);
  });

  it("treats missing query data as an empty queue", () => {
    expect(buildExecutionQueue(undefined)).toEqual([]);
  });

  it("keeps priority queue scoped to upcoming work, not active or completed rows", () => {
    const rows = buildPriorityQueueItems([
      {
        id: "done",
        identifier: "BOB-1",
        title: "Done task",
        kind: "task",
        status: "done",
      },
      {
        id: "stopped",
        identifier: "BOB-5",
        title: "Stopped task",
        kind: "task",
        status: "stopped",
      },
      {
        id: "errored",
        identifier: "BOB-6",
        title: "Errored task",
        kind: "task",
        status: "error",
      },
      {
        id: "interrupted",
        identifier: "BOB-7",
        title: "Interrupted task",
        kind: "task",
        status: "interrupted",
      },
      {
        id: "active",
        identifier: "BOB-2",
        title: "Active task",
        kind: "task",
        status: "in_progress",
      },
      {
        id: "agent-running",
        identifier: "BOB-3",
        title: "Agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-1",
          status: "running",
          agentType: "codex",
        },
      },
      {
        id: "pending-agent",
        identifier: "BOB-12",
        title: "Pending agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-5",
          status: "pending",
          agentType: "codex",
        },
      },
      {
        id: "awaiting-agent",
        identifier: "BOB-13",
        title: "Awaiting input agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-6",
          status: "awaiting-input",
          agentType: "codex",
        },
      },
      {
        id: "awaiting-underscore-agent",
        identifier: "BOB-14",
        title: "Awaiting input agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-7",
          status: "awaiting_input",
          agentType: "cursor",
        },
      },
      {
        id: "failed-agent",
        identifier: "BOB-8",
        title: "Failed agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-2",
          status: "failed",
          agentType: "codex",
        },
      },
      {
        id: "stopped-agent",
        identifier: "BOB-10",
        title: "Stopped agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-3",
          status: "stopped",
          agentType: "codex",
        },
      },
      {
        id: "cancelled-agent",
        identifier: "BOB-11",
        title: "Cancelled agent task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-4",
          status: "cancelled",
          agentType: "cursor",
        },
      },
      {
        id: "ready",
        identifier: "BOB-4",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "ready-issue",
        identifier: "BOB-9",
        title: "Ready issue",
        kind: "issue",
        status: "ready",
      },
    ]);

    expect(rows.map((item) => item.id)).toEqual(["ready"]);
  });

  it("orders the priority queue by priority before saved queue position", () => {
    const rows = buildPriorityQueueItems([
      {
        id: "low-first",
        identifier: "BOB-1",
        title: "Low task",
        kind: "task",
        status: "ready",
        priority: "low",
        queueSortOrder: 1,
      },
      {
        id: "urgent-later",
        identifier: "BOB-2",
        title: "Urgent task",
        kind: "task",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 10,
      },
      {
        id: "high-same-order",
        identifier: "BOB-3",
        title: "High task",
        kind: "task",
        status: "ready",
        priority: "high",
        queueSortOrder: 2,
      },
    ]);

    expect(rows.map((item) => item.id)).toEqual([
      "urgent-later",
      "high-same-order",
      "low-first",
    ]);
  });

  it("builds saved queue order from the visible upcoming rows only", () => {
    expect(
      buildPriorityQueueSaveOrder([
        {
          id: "ready",
          identifier: "BOB-1",
          title: "Ready task",
          kind: "task",
          status: "ready",
        },
        {
          id: "backlog",
          identifier: "BOB-2",
          title: "Backlog task",
          kind: "task",
          status: "backlog",
        },
      ]),
    ).toEqual(["ready", "backlog"]);
  });

  it("exposes explicit save and priority-sort controls for the mobile priority queue", () => {
    expect(buildPriorityQueueControls({ itemCount: 3, isSaving: false })).toEqual([
      { key: "save", label: "Save queue", disabled: false },
      { key: "sort-priority", label: "Sort priority", disabled: false },
    ]);

    expect(buildPriorityQueueControls({ itemCount: 0, isSaving: false })).toEqual([
      { key: "save", label: "Save queue", disabled: true },
      { key: "sort-priority", label: "Sort priority", disabled: true },
    ]);

    expect(buildPriorityQueueControls({ itemCount: 3, isSaving: true })[0]).toEqual({
      key: "save",
      label: "Saving...",
      disabled: true,
    });
  });

  it("moves one queued work item up or down without losing the remaining order", () => {
    const ids = ["first", "second", "third"];

    expect(moveQueueItem(ids, "second", "up")).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(moveQueueItem(ids, "second", "down")).toEqual([
      "first",
      "third",
      "second",
    ]);
    expect(moveQueueItem(ids, "first", "up")).toEqual(ids);
    expect(moveQueueItem(ids, "third", "down")).toEqual(ids);
  });

  it("only manually reorders queued tasks inside the same priority group", () => {
    const rows = [
      {
        id: "urgent",
        identifier: "BOB-1",
        title: "Urgent task",
        kind: "task",
        status: "ready",
        priority: "urgent",
      },
      {
        id: "high-1",
        identifier: "BOB-2",
        title: "High one",
        kind: "task",
        status: "ready",
        priority: "high",
      },
      {
        id: "high-2",
        identifier: "BOB-3",
        title: "High two",
        kind: "task",
        status: "ready",
        priority: "high",
      },
      {
        id: "low",
        identifier: "BOB-4",
        title: "Low task",
        kind: "task",
        status: "ready",
        priority: "low",
      },
    ];
    const ids = rows.map((row) => row.id);

    expect(canMoveQueueItem(rows, "high-1", "up")).toBe(false);
    expect(canMoveQueueItem(rows, "high-1", "down")).toBe(true);
    expect(canMoveQueueItem(rows, "high-2", "up")).toBe(true);
    expect(canMoveQueueItem(rows, "high-2", "down")).toBe(false);
    expect(moveQueueItem(ids, "high-1", "up", rows)).toEqual(ids);
    expect(moveQueueItem(ids, "high-1", "down", rows)).toEqual([
      "urgent",
      "high-2",
      "high-1",
      "low",
    ]);
  });

  it("can derive a saved queue order sorted by priority", () => {
    const sorted = sortQueueItemsByPriority([
      {
        id: "low",
        identifier: "BOB-3",
        title: "Low task",
        kind: "task",
        status: "ready",
        priority: "low",
      },
      {
        id: "urgent",
        identifier: "BOB-1",
        title: "Urgent task",
        kind: "task",
        status: "ready",
        priority: "urgent",
      },
      {
        id: "high",
        identifier: "BOB-2",
        title: "High task",
        kind: "task",
        status: "ready",
        priority: "high",
      },
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["urgent", "high", "low"]);
  });

  it("only enables dispatch controls for dispatchable queued tasks", () => {
    expect(
      getQueueItemDispatchAction({
        id: "ready",
        identifier: "BOB-1",
        title: "Ready task",
        kind: "task",
        status: "ready",
      }),
    ).toEqual({ kind: "dispatch" });

    expect(
      getQueueItemDispatchAction({
        id: "review",
        identifier: "BOB-2",
        title: "Review task",
        kind: "task",
        status: "in_review",
      }),
    ).toEqual({ kind: "none" });

    expect(
      getQueueItemDispatchAction({
        id: "project",
        identifier: "BOB-3",
        title: "Project setup",
        kind: "project",
        status: "ready",
      }),
    ).toEqual({ kind: "none" });
  });

  it("puts active work into the agent lane and ready work into the queue lane", () => {
    const lanes = buildQueueLanes([
      {
        id: "ready",
        identifier: "BOB-1",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "running",
        identifier: "BOB-2",
        title: "Running task",
        kind: "task",
        status: "in_progress",
        agentStatus: {
          sessionId: "session-2",
          status: "running",
          agentType: "claude",
        },
      },
      {
        id: "pending",
        identifier: "BOB-5",
        title: "Pending task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-5",
          status: "pending",
          agentType: "codex",
        },
      },
      {
        id: "awaiting",
        identifier: "BOB-6",
        title: "Awaiting input task",
        kind: "task",
        status: "ready",
        agentStatus: {
          sessionId: "session-6",
          status: "awaiting-input",
          agentType: "codex",
        },
      },
      {
        id: "review",
        identifier: "BOB-3",
        title: "Review task",
        kind: "task",
        status: "in_review",
      },
      {
        id: "done",
        identifier: "BOB-4",
        title: "Done task",
        kind: "task",
        status: "done",
      },
    ]);

    expect(lanes.active.map((item) => item.id)).toEqual([
      "running",
      "pending",
      "awaiting",
    ]);
    expect(lanes.queued.map((item) => item.id)).toEqual(["ready"]);
    expect(lanes.review.map((item) => item.id)).toEqual(["review"]);
    expect(lanes.done.map((item) => item.id)).toEqual(["done"]);
  });

  it("unwraps work item detail envelopes returned by workItem.get", () => {
    expect(
      unwrapWorkItemDetail({
        workItem: {
          id: "task-1",
          identifier: "BOB-1",
          title: "Fix tablet flow",
          description: null,
          kind: "task",
          status: "in_progress",
        },
        currentArtifacts: [],
      }),
    ).toMatchObject({
      id: "task-1",
      identifier: "BOB-1",
      status: "in_progress",
      currentArtifacts: [],
    });
  });

  it("formats missing statuses without crashing", () => {
    expect(formatStatusLabel(undefined)).toBe("Unknown");
    expect(formatStatusLabel("in_progress")).toBe("In Progress");
  });
});
