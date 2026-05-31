import { describe, expect, it } from "vitest";

import {
  buildExecutionQueue,
  buildQueueLanes,
  formatStatusLabel,
  moveQueueItem,
  unwrapWorkItemDetail,
} from "./queue";

describe("tablet execution queue", () => {
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

    expect(lanes.active.map((item) => item.id)).toEqual(["running"]);
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
