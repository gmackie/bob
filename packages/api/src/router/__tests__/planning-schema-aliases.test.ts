import { describe, expect, it } from "vitest";

import {
  chatConversations,
  repositories,
  taskRuns,
  worktreePlans,
} from "@bob/db/schema";

describe("planning/work-item schema aliases", () => {
  it("exposes planning-named aliases for legacy planning columns", () => {
    expect(repositories.planningProjectId.name).toBe("kanbanger_project_id");
    expect(chatConversations.planningTaskId.name).toBe("kanbanger_task_id");
    expect(worktreePlans.planningTaskId.name).toBe("kanbanger_task_id");
    expect(taskRuns.planningWorkspaceId.name).toBe("kanbanger_workspace_id");
    expect(taskRuns.planningItemId.name).toBe("kanbanger_issue_id");
    expect(taskRuns.planningItemIdentifier.name).toBe(
      "kanbanger_issue_identifier",
    );
  });
});
