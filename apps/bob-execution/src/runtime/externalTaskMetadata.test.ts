import { describe, expect, it } from "vitest";

import { buildBobExternalTaskMetadata } from "./externalTaskMetadata.js";

describe("buildBobExternalTaskMetadata", () => {
  it("builds the shared Linear metadata sent to t3code", () => {
    expect(
      buildBobExternalTaskMetadata({
        task: {
          id: "work-item-1",
          externalProvider: "linear",
          externalId: "linear-issue-1",
          identifier: "ENG-42",
          title: "Replace Bob runner",
          description: "Use t3code server",
          workspaceId: "workspace-1",
          projectId: "project-1",
          assigneeId: null,
          labels: [],
          priority: 0,
          url: "https://tasks.gmac.io/gmac/issue/ENG-42/replace-bob-runner",
          linearWebBaseUrl: "https://tasks.gmac.io",
        },
        planningProvider: "linear",
        taskRunId: "task-run-1",
      }),
    ).toEqual({
      origin: "bob",
      planningProvider: "linear",
      linearIssueId: "linear-issue-1",
      linearIdentifier: "ENG-42",
      linearTitle: "Replace Bob runner",
      linearUrl: "https://tasks.gmac.io/gmac/issue/ENG-42/replace-bob-runner",
      linearWebBaseUrl: "https://tasks.gmac.io",
      bobWorkspaceId: "workspace-1",
      bobWorkItemId: "work-item-1",
      bobTaskRunId: "task-run-1",
    });
  });

  it("keeps internal tasks free of Linear fields", () => {
    expect(
      buildBobExternalTaskMetadata({
        task: {
          id: "work-item-2",
          identifier: "BOB-7",
          title: "Internal task",
          description: null,
          workspaceId: "workspace-1",
          projectId: "project-1",
          assigneeId: null,
          labels: [],
          priority: 0,
        },
        planningProvider: "internal",
        taskRunId: "task-run-2",
      }),
    ).toEqual({
      origin: "bob",
      planningProvider: "internal",
      bobWorkspaceId: "workspace-1",
      bobWorkItemId: "work-item-2",
      bobTaskRunId: "task-run-2",
    });
  });
});
