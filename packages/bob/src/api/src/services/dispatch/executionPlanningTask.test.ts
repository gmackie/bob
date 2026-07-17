import { describe, expect, it } from "vitest";

import { buildExecutionPlanningTask } from "./executionPlanningTask.js";

describe("buildExecutionPlanningTask", () => {
  it("passes Linear external identity from work items into Bob execution", () => {
    expect(
      buildExecutionPlanningTask({
        batch: {
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
        item: {
          planningTaskId: "work-item-1",
          planningTaskIdentifier: "ENG-42",
          title: "Replace Bob runner",
          description: "Use t3code server",
        },
        workItem: {
          externalProvider: "linear",
          externalId: "linear-issue-1",
        },
      }),
    ).toMatchObject({
      id: "work-item-1",
      identifier: "ENG-42",
      workspaceId: "workspace-1",
      projectId: "project-1",
      externalProvider: "linear",
      externalId: "linear-issue-1",
    });
  });
});
