import { describe, expect, it } from "vitest";

import { getWorkItemDetailPresentation } from "./work-item-detail";

describe("mobile work-item detail presentation", () => {
  it("prompts issues to promote before execution", () => {
    expect(
      getWorkItemDetailPresentation({
        id: "issue-123",
        kind: "issue",
      }),
    ).toEqual({
      primaryActionLabel: "Promote to task",
      executionHref: "/work-items/issue-123/workspace",
      semanticSummary: "Issues capture work to be shaped before execution.",
      semanticHint: "Promote this issue to a task when it is ready for Bob.",
    });
  });

  it("sends tasks directly into the execution workspace", () => {
    expect(
      getWorkItemDetailPresentation({
        id: "task-123",
        kind: "task",
      }),
    ).toEqual({
      primaryActionLabel: "Open execution workspace",
      executionHref: "/work-items/task-123/workspace",
      semanticSummary: "Tasks are the executable unit for BizPulse.",
      semanticHint:
        "Open the execution workspace to chat, review status, and inspect artifacts.",
    });
  });
});
