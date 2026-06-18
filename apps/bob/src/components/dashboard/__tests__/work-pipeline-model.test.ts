import { describe, expect, it } from "vitest";

import { groupWorkPipelineItems } from "../work-pipeline-model";

describe("work pipeline model", () => {
  it("groups work by lifecycle lane instead of recency", () => {
    const lanes = groupWorkPipelineItems([
      {
        id: "ready",
        identifier: "BOB-1",
        title: "Ready task",
        kind: "task",
        status: "ready",
      },
      {
        id: "active",
        identifier: "BOB-2",
        title: "Active task",
        kind: "task",
        status: "in_progress",
        agentStatus: { sessionId: "session-2", status: "running", agentType: "claude" },
      },
      {
        id: "review",
        identifier: "BOB-3",
        title: "Review task",
        kind: "task",
        status: "blocked",
      },
      {
        id: "done",
        identifier: "BOB-4",
        title: "Done task",
        kind: "task",
        status: "done",
      },
    ]);

    expect(lanes.active.map((item) => item.id)).toEqual(["active"]);
    expect(lanes.queued.map((item) => item.id)).toEqual(["ready"]);
    expect(lanes.review.map((item) => item.id)).toEqual(["review"]);
    expect(lanes.done.map((item) => item.id)).toEqual(["done"]);
  });
});
