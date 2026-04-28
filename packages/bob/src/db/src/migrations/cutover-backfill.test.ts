import { describe, expect, it } from "vitest";

import { buildArtifactBackfill } from "./artifact-backfill";
import { buildSessionTaskLinkBackfill } from "./session-task-link-backfill";
import { buildWorkItemBackfill } from "./work-items-backfill";

describe("monorepo cutover backfills", () => {
  it("maps legacy planning records into typed work items with stable sequence numbers", () => {
    const result = buildWorkItemBackfill({
      projects: [
        {
          id: "project-1",
          workspaceId: "workspace-1",
          key: "MERGE",
        },
      ],
      issues: [
        {
          legacyId: "issue-1",
          projectId: "project-1",
          ownerUserId: "user-1",
          title: "Mobile merge",
          description: "Bring planning and execution together.",
          status: "triaged",
          createdAt: new Date("2026-03-10T10:00:00.000Z"),
          updatedAt: new Date("2026-03-10T10:00:00.000Z"),
        },
      ],
      epics: [
        {
          legacyId: "epic-1",
          projectId: "project-1",
          parentLegacyId: "issue-1",
          ownerUserId: "user-1",
          title: "Task-scoped execution",
          status: "planned",
          createdAt: new Date("2026-03-10T11:00:00.000Z"),
          updatedAt: new Date("2026-03-10T11:00:00.000Z"),
        },
      ],
      tasks: [
        {
          legacyId: "task-1",
          projectId: "project-1",
          parentLegacyId: "epic-1",
          ownerUserId: "user-1",
          assigneeUserId: "user-2",
          title: "Port the mobile workspace route",
          status: "in_progress",
          createdAt: new Date("2026-03-10T12:00:00.000Z"),
          updatedAt: new Date("2026-03-10T12:00:00.000Z"),
        },
      ],
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        legacyId: "issue-1",
        kind: "issue",
        identifier: "MERGE-1",
        parentLegacyId: null,
      }),
      expect.objectContaining({
        legacyId: "epic-1",
        kind: "epic",
        identifier: "MERGE-2",
        parentLegacyId: "issue-1",
      }),
      expect.objectContaining({
        legacyId: "task-1",
        kind: "task",
        identifier: "MERGE-3",
        parentLegacyId: "epic-1",
        assigneeUserId: "user-2",
      }),
    ]);
    expect(result.legacyToWorkItemId).toEqual({
      "issue-1": result.items[0]?.id,
      "epic-1": result.items[1]?.id,
      "task-1": result.items[2]?.id,
    });
  });

  it("creates immutable artifact history with one current artifact per role", () => {
    const result = buildArtifactBackfill({
      legacyToWorkItemId: {
        "task-1": "work-item-task-1",
      },
      artifacts: [
        {
          legacyId: "artifact-1",
          workItemLegacyId: "task-1",
          role: "verification",
          type: "verification",
          producerType: "bob",
          url: "https://example.com/verification-1",
          createdAt: new Date("2026-03-10T12:30:00.000Z"),
        },
        {
          legacyId: "artifact-2",
          workItemLegacyId: "task-1",
          role: "verification",
          type: "verification",
          producerType: "bob",
          url: "https://example.com/verification-2",
          createdAt: new Date("2026-03-10T13:30:00.000Z"),
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        legacyId: "artifact-1",
        workItemId: "work-item-task-1",
        isCurrent: false,
      }),
      expect.objectContaining({
        legacyId: "artifact-2",
        workItemId: "work-item-task-1",
        isCurrent: true,
      }),
    ]);
  });

  it("links legacy task runs and chat sessions onto cutover work items", () => {
    const result = buildSessionTaskLinkBackfill({
      legacyToWorkItemId: {
        "task-1": "work-item-task-1",
      },
      taskRuns: [
        {
          id: "run-1",
          legacyWorkItemId: "task-1",
          sessionId: "session-1",
          identifier: "MERGE-3",
        },
      ],
      chatSessions: [
        {
          id: "session-1",
          legacyWorkItemId: "task-1",
          identifier: "MERGE-3",
        },
      ],
    });

    expect(result.taskRunUpdates).toEqual([
      {
        id: "run-1",
        workItemId: "work-item-task-1",
        workItemIdentifierSnapshot: "MERGE-3",
      },
    ]);
    expect(result.chatSessionUpdates).toEqual([
      {
        id: "session-1",
        workItemId: "work-item-task-1",
        workItemIdentifierSnapshot: "MERGE-3",
      },
    ]);
  });
});
