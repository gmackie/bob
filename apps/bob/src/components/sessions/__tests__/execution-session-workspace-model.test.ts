import { describe, expect, it } from "vitest";

import { getExecutionSessionLinkedTaskHref } from "../execution-session-workspace-model";

describe("execution session workspace model", () => {
  it("routes linked work items to outcome detail with the selected workspace", () => {
    expect(
      getExecutionSessionLinkedTaskHref({
        workItemId: "task-1",
        linkedTaskUrl: "/work-items/task-1/workspace",
        workspaceId: "workspace-1",
      }),
    ).toBe("/work-items/task-1?view=outcome&workspace=workspace-1");
  });

  it("preserves legacy linked task urls when no work item id is available", () => {
    expect(
      getExecutionSessionLinkedTaskHref({
        workItemId: null,
        linkedTaskUrl: "/work-items/task-1/workspace",
        workspaceId: "workspace-1",
      }),
    ).toBe("/work-items/task-1/workspace?workspace=workspace-1");
  });

  it("returns null when no linked task target exists", () => {
    expect(
      getExecutionSessionLinkedTaskHref({
        workItemId: null,
        linkedTaskUrl: null,
        workspaceId: "workspace-1",
      }),
    ).toBeNull();
  });
});
