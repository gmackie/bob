// Deterministic in-memory stubs for the WorkItemsRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 1 + Task 2.
import { Effect } from "effect";

import { WorkItemsRpc } from "../groups/work-items.js";

export const WorkItemsStubLayer = WorkItemsRpc.toLayer({
  // --- Core (Task 1) ---
  "workItem.list": () => Effect.succeed([]),
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
});
