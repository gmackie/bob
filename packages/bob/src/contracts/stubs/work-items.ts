// Deterministic in-memory stubs for the WorkItemsRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 1.
import { Effect } from "effect";

import { WorkItemsRpc } from "../groups/work-items.js";

export const WorkItemsStubLayer = WorkItemsRpc.toLayer({
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
});
