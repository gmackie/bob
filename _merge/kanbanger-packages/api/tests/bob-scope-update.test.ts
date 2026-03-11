import { describe, expect, it } from "vitest";

import { buildBobIssueUpdateMetadata } from "../src/routers/issue";

const currentIssue = {
  id: "issue-1",
  title: "Original title",
  description: "Original description",
  priority: "medium",
  assigneeId: "user-1",
  projectId: "project-1",
  parentId: null,
  epicId: null,
} as const;

describe("Bob issue scope updates", () => {
  it("captures substantive issue edits as structured context changes", () => {
    expect(
      buildBobIssueUpdateMetadata(currentIssue as never, {
        title: "Updated title",
        description: "Updated description",
        assigneeId: "user-2",
      }),
    ).toEqual({
      changedFields: [
        {
          field: "title",
          from: "Original title",
          to: "Updated title",
        },
        {
          field: "description",
          from: "Original description",
          to: "Updated description",
        },
        {
          field: "assigneeId",
          from: "user-1",
          to: "user-2",
        },
      ],
      forceNewRun: false,
    });
  });

  it("forces a new run when the project context changes", () => {
    expect(
      buildBobIssueUpdateMetadata(currentIssue as never, {
        projectId: "project-2",
      }),
    ).toEqual({
      changedFields: [
        {
          field: "projectId",
          from: "project-1",
          to: "project-2",
        },
      ],
      forceNewRun: true,
    });
  });

  it("returns null when no substantive Bob-facing fields changed", () => {
    expect(
      buildBobIssueUpdateMetadata(currentIssue as never, {
        sortOrder: 42,
      } as never),
    ).toBeNull();
  });
});
