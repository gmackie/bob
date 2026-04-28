import { describe, expect, it } from "vitest";

import {
  chatConversations,
  linkTypeEnum,
  pullRequests,
  repositories,
  taskRuns,
  worktreePlans,
} from "@bob/db/schema";
import { buildPlanningNamingBackfill } from "../../../../db/src/migrations/planning-naming-backfill";

describe("planning/work-item schema aliases", () => {
  it("exposes planning-named aliases for legacy planning columns", () => {
    expect(repositories.planningProjectId.name).toBe("kanbanger_project_id");
    expect(chatConversations.planningTaskId.name).toBe("kanbanger_task_id");
    expect(worktreePlans.planningTaskId.name).toBe("kanbanger_task_id");
    expect(pullRequests.planningTaskId.name).toBe("kanbanger_task_id");
    expect(taskRuns.planningWorkspaceId.name).toBe("kanbanger_workspace_id");
    expect(taskRuns.planningItemId.name).toBe("kanbanger_issue_id");
    expect(taskRuns.planningItemIdentifier.name).toBe(
      "kanbanger_issue_identifier",
    );
  });

  it("backfills stored legacy naming to planning values", () => {
    expect(linkTypeEnum).toContain("planning_task");
    expect(linkTypeEnum).not.toContain("kanbanger_task");

    const result = buildPlanningNamingBackfill({
      worktreeLinks: [
        { id: "link-1", linkType: "kanbanger_task" },
        { id: "link-2", linkType: "github_pr" },
      ],
      webhookDeliveries: [
        {
          id: "delivery-1",
          provider: "kanbanger",
          eventType: "kanbanger_comment",
        },
        {
          id: "delivery-2",
          provider: "github",
          eventType: "push",
        },
        {
          id: "delivery-3",
          provider: "kanbanger",
          eventType: "kanbanger_comment_late",
        },
      ],
    });

    expect(result.worktreeLinks).toEqual([
      { id: "link-1", linkType: "planning_task" },
      { id: "link-2", linkType: "github_pr" },
    ]);
    expect(result.webhookDeliveries).toEqual([
      {
        id: "delivery-1",
        provider: "planning",
        eventType: "planning_comment",
      },
      {
        id: "delivery-2",
        provider: "github",
        eventType: "push",
      },
      {
        id: "delivery-3",
        provider: "planning",
        eventType: "planning_comment_late",
      },
    ]);
  });
});
