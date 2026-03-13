import { describe, expect, it } from "vitest";

import {
  buildProjectExecutionSummary,
  getProjectWorkItemAction,
} from "./project-detail";

describe("mobile project detail presentation", () => {
  it("summarizes project execution counts across task states", () => {
    expect(
      buildProjectExecutionSummary([
        {
          id: "task-1",
          identifier: "MOB-1",
          title: "Ship auth",
          kind: "task",
          status: "in_progress",
        },
        {
          id: "task-2",
          identifier: "MOB-2",
          title: "Review UI",
          kind: "task",
          status: "in_review",
        },
        {
          id: "task-3",
          identifier: "MOB-3",
          title: "Need product signoff",
          kind: "task",
          status: "blocked",
        },
        {
          id: "issue-1",
          identifier: "MOB-4",
          title: "Triage bug",
          kind: "issue",
          status: "backlog",
        },
      ]),
    ).toEqual({
      inProgress: 1,
      inReview: 1,
      blocked: 1,
    });
  });

  it("routes tasks to workspace and planning items to detail", () => {
    expect(
      getProjectWorkItemAction({
        id: "task-123",
        kind: "task",
      }),
    ).toEqual({
      href: "/work-items/task-123/workspace",
      label: "Workspace",
    });

    expect(
      getProjectWorkItemAction({
        id: "issue-123",
        kind: "issue",
      }),
    ).toEqual({
      href: "/work-items/issue-123",
      label: "Details",
    });
  });
});
