import { describe, expect, it } from "vitest";

import {
  buildProjectExecutionSummary,
  buildProjectWorkItemRows,
  getMobileProjectDetailQueryRefreshOptions,
  getProjectWorkItemAction,
} from "./project-detail";

describe("mobile project detail presentation", () => {
  it("uses short polling as the mobile project detail fallback", () => {
    expect(getMobileProjectDetailQueryRefreshOptions()).toEqual({
      refetchInterval: 15_000,
    });
  });

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
      href: "/work-items/task-123?view=queue",
      label: "Priority Queue",
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
    expect(
      getProjectWorkItemAction({
        id: "task-123",
        kind: "task",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      href: "/work-items/task-123?view=queue&workspace=workspace-1",
      label: "Priority Queue",
    });
    expect(
      getProjectWorkItemAction({
        id: "issue-123",
        kind: "issue",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      href: "/work-items/issue-123?workspace=workspace-1",
      label: "Details",
    });
  });

  it("builds project work item rows with project workspace-scoped actions", () => {
    expect(
      buildProjectWorkItemRows({
        workspaceId: "workspace-1",
        items: [
          {
            id: "task-123",
            identifier: "MOB-1",
            title: "Implement queue controls",
            kind: "task",
            status: "in_progress",
          },
          {
            id: "issue-123",
            identifier: "MOB-2",
            title: "Shape dashboard",
            kind: "issue",
            status: "ready",
          },
        ],
      }),
    ).toEqual([
      {
        id: "task-123",
        title: "MOB-1 · Implement queue controls",
        subtitle: "task · in progress",
        actionLabel: "Priority Queue",
        href: "/work-items/task-123?view=queue&workspace=workspace-1",
      },
      {
        id: "issue-123",
        title: "MOB-2 · Shape dashboard",
        subtitle: "issue · ready",
        actionLabel: "Details",
        href: "/work-items/issue-123?workspace=workspace-1",
      },
    ]);
  });
});
