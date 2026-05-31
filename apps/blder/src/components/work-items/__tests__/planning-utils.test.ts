import { describe, expect, it } from "vitest";

import {
  dedupeWorkItemsByBoardIdentity,
  groupWorkItemsByStatus,
  summarizeProjects,
} from "../planning-utils";

describe("planning utils", () => {
  it("groups work items into planning board columns", () => {
    const groups = groupWorkItemsByStatus([
      { id: "1", status: "draft", title: "Idea" },
      { id: "2", status: "todo", title: "Ready task" },
      { id: "3", status: "in_progress", title: "Active task" },
      { id: "4", status: "in_review", title: "Review task" },
      { id: "5", status: "completed", title: "Done task" },
    ]);

    expect(groups.backlog.map((item) => item.id)).toEqual(["1"]);
    expect(groups.todo.map((item) => item.id)).toEqual(["2"]);
    expect(groups.inProgress.map((item) => item.id)).toEqual(["3"]);
    expect(groups.inReview.map((item) => item.id)).toEqual(["4"]);
    expect(groups.done.map((item) => item.id)).toEqual(["5"]);
  });

  it("summarizes project cards from project counts", () => {
    const summary = summarizeProjects([
      {
        project: {
          id: "project-1",
          name: "Merge",
          key: "MERGE",
          color: "#2255cc",
          status: "in_progress",
        },
        counts: {
          issues: 3,
          tasks: 5,
          epics: 1,
          active: 2,
        },
      },
    ]);

    expect(summary).toEqual([
      expect.objectContaining({
        id: "project-1",
        label: "MERGE",
        totals: "3 issues / 5 tasks / 1 epic",
        activeLabel: "2 active",
      }),
    ]);
  });

  it("dedupes board items by identifier while preserving the first result", () => {
    const items = dedupeWorkItemsByBoardIdentity([
      { id: "newest", identifier: "BOB-100", status: "todo", title: "Keep" },
      { id: "older", identifier: "BOB-100", status: "todo", title: "Drop" },
      {
        id: "unique",
        identifier: "BOB-101",
        status: "todo",
        title: "Keep too",
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(["newest", "unique"]);
  });
});
