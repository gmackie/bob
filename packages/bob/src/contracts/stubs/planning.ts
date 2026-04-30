// Deterministic in-memory stubs for the PlanningRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 4.
import { Effect } from "effect";

import { PlanningRpc } from "../groups/planning.js";

export const PlanningStubLayer = PlanningRpc.toLayer({
  // --- Core planning ---
  "planning.listWorkspaces": () => Effect.succeed([]),
  "planning.listProjects": () => Effect.succeed([]),
  "planning.getProject": () => Effect.succeed(null),
  "planning.listTasks": () => Effect.succeed([]),
  "planning.getTask": () => Effect.succeed(null),
  "planning.getTaskByIdentifier": () => Effect.succeed(null),
  "planning.createTask": () =>
    Effect.succeed({
      id: "stub-task-1",
      identifier: "PROJ-1",
      title: "stub task",
      status: "todo",
      priority: "no_priority",
    }),
  "planning.updateTask": () =>
    Effect.succeed({
      id: "stub-task-1",
      identifier: "PROJ-1",
      title: "stub task",
      status: "todo",
      priority: "no_priority",
    }),
  "planning.addComment": () =>
    Effect.succeed({
      id: "stub-comment-1",
      body: "stub comment",
    }),
  "planning.listComments": () => Effect.succeed([]),
  "planning.searchTasks": () => Effect.succeed([]),
  "planning.listLabels": () => Effect.succeed([]),
  "planning.listCycles": () => Effect.succeed([]),
  "planning.getCurrentUser": () =>
    Effect.succeed({
      id: "stub-user-1",
      email: "stub@example.com",
      name: "Stub User",
    }),
  // --- Agent procedures ---
  "planning.agentClaimTask": () =>
    Effect.succeed({
      id: "stub-claim-1",
      issueId: "stub-issue-1",
      status: "claimed",
      claimedAt: "2026-01-01T00:00:00.000Z",
    }),
  "planning.agentReportProgress": () =>
    Effect.succeed({
      id: "stub-taskrun-1",
      status: "in_progress",
    }),
  "planning.agentCompleteTask": () =>
    Effect.succeed({
      id: "stub-taskrun-1",
      status: "completed",
      completedAt: "2026-01-01T00:00:00.000Z",
    }),
  "planning.agentFailTask": () =>
    Effect.succeed({
      id: "stub-taskrun-1",
      status: "failed",
    }),
  "planning.agentGetAvailableTasks": () => Effect.succeed([]),
  "planning.agentStartSession": () =>
    Effect.succeed({
      id: "stub-session-1",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  "planning.agentEndSession": () =>
    Effect.succeed({
      id: "stub-session-1",
      endedAt: "2026-01-01T00:00:00.000Z",
    }),
});
