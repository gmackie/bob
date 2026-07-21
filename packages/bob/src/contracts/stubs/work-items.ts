// Deterministic in-memory stubs for the WorkItemsRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 1 + Task 2.
import { Effect } from "effect";

import { WorkItemsRpc } from "../groups/work-items.js";

export const WorkItemsStubLayer = WorkItemsRpc.toLayer({
  // --- Core (Task 1) ---
  "workItem.list": () => Effect.succeed([]),
  "workItem.statusCounts": () => Effect.succeed({}),
  "workItem.get": () => Effect.succeed(null),
  "workItem.update": () => Effect.succeed(null),
  "workItem.promoteToTask": () => Effect.succeed(null),
  "workItem.comment.list": () => Effect.succeed([]),
  "workItem.comment.create": () =>
    Effect.succeed({
      id: "stub-comment-1",
      workItemId: "stub-wi-1",
      userId: "stub-user-1",
      body: "stub comment",
    }),
  // --- Artifact (Task 2) ---
  "workItem.artifact.create": () =>
    Effect.succeed({
      id: "stub-artifact-1",
      workItemId: "stub-wi-1",
      producerType: "manual",
      artifactType: "other",
      artifactRole: "output",
    }),
  "workItem.artifact.listCurrent": () => Effect.succeed([]),
  "workItem.artifact.listChildGroups": () => Effect.succeed([]),
  // --- Activity (Task 2) ---
  "workItem.activity.list": () => Effect.succeed([]),
  "workItem.activity.listRecent": () => Effect.succeed([]),
  // --- Notification (Task 2) ---
  "workItem.notification.list": () => Effect.succeed({ items: [] }),
  "workItem.notification.create": () =>
    Effect.succeed({
      id: "stub-notif-1",
      userId: "stub-user-1",
      type: "work_item_assigned",
      title: "stub notification",
    }),
  "workItem.notification.markAsRead": () => Effect.succeed(null),
  "workItem.notification.markAllAsRead": () => Effect.succeed({ count: 0 }),
  "workItem.notification.registerPushToken": () =>
    Effect.succeed({ ok: true }),
  // --- TaskRun (Task 2) ---
  "workItem.taskRun.listByWorkItem": () => Effect.succeed([]),
  "workItem.taskRun.execute": () =>
    Effect.succeed({
      id: "stub-taskrun-1",
      userId: "stub-user-1",
      status: "starting",
    }),
  "workItem.taskRun.listLifecycleEvents": () => Effect.succeed([]),
  // --- Requirement (Task 3) ---
  "workItem.requirement.list": () => Effect.succeed([]),
  "workItem.requirement.create": () =>
    Effect.succeed({
      id: "stub-req-1",
      workItemId: "stub-wi-1",
      category: "other",
      description: "stub requirement",
      status: "pending",
      sortOrder: 0,
    }),
  "workItem.requirement.update": () =>
    Effect.succeed({
      id: "stub-req-1",
      workItemId: "stub-wi-1",
      category: "other",
      description: "stub requirement",
      status: "pending",
      sortOrder: 0,
    }),
  "workItem.requirement.delete": () => Effect.succeed({ ok: true }),
  "workItem.requirement.linkToTask": () =>
    Effect.succeed({
      id: "stub-req-1",
      workItemId: "stub-wi-1",
      category: "other",
      description: "stub requirement",
      status: "pending",
      sortOrder: 0,
    }),
  // --- Link (Task 3) ---
  "workItem.link.list": () => Effect.succeed([]),
  "workItem.link.byId": () => Effect.succeed(null),
  "workItem.link.byWorktree": () => Effect.succeed([]),
  "workItem.link.create": () =>
    Effect.succeed({
      id: "stub-link-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      linkType: "external",
    }),
  "workItem.link.update": () =>
    Effect.succeed({
      id: "stub-link-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      linkType: "external",
    }),
  "workItem.link.delete": () => Effect.succeed({ ok: true }),
  "workItem.link.linkToPlanningTask": () =>
    Effect.succeed({
      id: "stub-link-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      linkType: "planning_task",
    }),
  "workItem.link.linkToGitHubPR": () =>
    Effect.succeed({
      id: "stub-link-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      linkType: "github_pr",
    }),
});
