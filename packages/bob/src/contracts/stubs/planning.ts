// Deterministic in-memory stubs for the PlanningRpc contract group.
// Returns plausible mock data so consumers can wire up typed calls before
// real service handlers land. 7B-4C Task 4 + Task 5 + Task 6 + Task 7.
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
  // --- Planning session procedures (Task 5) ---
  "planning.session.create": () =>
    Effect.succeed({
      id: "stub-plan-session-1",
      userId: "stub-user-1",
      title: "Planning session",
      status: "provisioning",
    }),
  "planning.session.start": () =>
    Effect.succeed({
      ok: true,
      sessionId: "stub-plan-session-1",
    }),
  "planning.session.get": () =>
    Effect.succeed(null),
  "planning.session.list": () =>
    Effect.succeed([]),
  "planning.session.listByWorkItem": () =>
    Effect.succeed([]),
  "planning.session.getActiveForWorkItem": () =>
    Effect.succeed(null),
  "planning.session.saveArtifact": () =>
    Effect.succeed({
      id: "stub-artifact-1",
      workItemId: "stub-wi-1",
    }),
  "planning.session.getPriorContext": () =>
    Effect.succeed([]),
  "planning.session.createDraft": () =>
    Effect.succeed({
      id: "stub-draft-1",
      sessionId: "stub-plan-session-1",
      title: "stub draft",
    }),
  "planning.session.updateDraft": () =>
    Effect.succeed({
      id: "stub-draft-1",
      sessionId: "stub-plan-session-1",
      title: "stub draft updated",
    }),
  "planning.session.removeDraft": () =>
    Effect.succeed({ ok: true }),
  "planning.session.setDependency": () =>
    Effect.succeed({
      id: "stub-dep-1",
      draftId: "stub-draft-1",
      dependsOnDraftId: "stub-draft-2",
    }),
  "planning.session.removeDependency": () =>
    Effect.succeed({ ok: true }),
  "planning.session.commitPlan": () =>
    Effect.succeed({
      committed: 0,
      tasks: [],
    }),
  "planning.session.commitPlanLocal": () =>
    Effect.succeed({
      committed: 0,
      workItems: [],
      dependencies: 0,
    }),
  // --- Worktree plan + task item procedures (Task 6) ---
  "planning.task.list": () => Effect.succeed([]),
  "planning.task.byId": () =>
    Effect.succeed({
      id: "stub-plan-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      filePath: "/stub/plan.md",
      status: "draft",
    }),
  "planning.task.byWorktree": () => Effect.succeed(null),
  "planning.task.create": () =>
    Effect.succeed({
      id: "stub-plan-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      filePath: "/stub/plan.md",
      status: "draft",
    }),
  "planning.task.update": () =>
    Effect.succeed({
      id: "stub-plan-1",
      worktreeId: "stub-wt-1",
      userId: "stub-user-1",
      filePath: "/stub/plan.md",
      status: "active",
    }),
  "planning.task.delete": () => Effect.succeed({ success: true }),
  "planning.task.syncFromFile": () => Effect.succeed({ success: true }),
  "planning.task.addTask": () =>
    Effect.succeed({
      id: "stub-task-item-1",
      planId: "stub-plan-1",
      taskKey: "T1",
      content: "stub task item",
      status: "pending",
      priority: "medium",
      sortOrder: 0,
    }),
  "planning.task.updateTask": () =>
    Effect.succeed({
      id: "stub-task-item-1",
      planId: "stub-plan-1",
      taskKey: "T1",
      content: "stub task item updated",
      status: "in_progress",
      priority: "medium",
      sortOrder: 0,
    }),
  "planning.task.deleteTask": () => Effect.succeed({ success: true }),
  "planning.task.reorderTasks": () => Effect.succeed({ success: true }),
  // --- Dispatch procedures (Task 6) ---
  "planning.dispatch.createBatch": () =>
    Effect.succeed({
      batch: {
        id: "stub-batch-1",
        userId: "stub-user-1",
        workspaceId: "stub-ws-1",
        projectId: "stub-proj-1",
        status: "pending",
        concurrency: 2,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
      },
      items: [],
    }),
  "planning.dispatch.getBatch": () =>
    Effect.succeed({
      batch: {
        id: "stub-batch-1",
        userId: "stub-user-1",
        workspaceId: "stub-ws-1",
        projectId: "stub-proj-1",
        status: "pending",
        concurrency: 2,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
      },
      items: [],
    }),
  "planning.dispatch.updateItemAgent": () =>
    Effect.succeed({
      id: "stub-item-1",
      batchId: "stub-batch-1",
      planningTaskId: "stub-task-1",
      planningTaskIdentifier: "PROJ-1",
      title: "stub dispatch item",
      agentType: "opencode",
      status: "queued",
      sortOrder: 0,
    }),
  "planning.dispatch.updateConcurrency": () =>
    Effect.succeed({
      id: "stub-batch-1",
      userId: "stub-user-1",
      workspaceId: "stub-ws-1",
      projectId: "stub-proj-1",
      status: "pending",
      concurrency: 3,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
    }),
  "planning.dispatch.dispatch": () =>
    Effect.succeed({ started: 0 }),
  "planning.dispatch.checkProgress": () =>
    Effect.succeed({
      batch: {
        id: "stub-batch-1",
        userId: "stub-user-1",
        workspaceId: "stub-ws-1",
        projectId: "stub-proj-1",
        status: "running",
        concurrency: 2,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
      },
      items: [],
    }),
  "planning.dispatch.listBatches": () => Effect.succeed([]),
  "planning.dispatch.resetPipelineState": () =>
    Effect.succeed({ ok: true }),
  // --- Skill procedures (Task 7) ---
  "planning.skill.list": () => Effect.succeed([]),
  "planning.skill.seed": () =>
    Effect.succeed({ seeded: 0, total: 10 }),
  "planning.skill.getExecution": () => Effect.succeed(null),
  "planning.skill.listExecutions": () => Effect.succeed([]),
  "planning.skill.recordExecution": () =>
    Effect.succeed({
      id: "stub-exec-1",
      skillSlug: "review",
      status: "running",
    }),
  "planning.skill.updateExecution": () =>
    Effect.succeed({
      id: "stub-exec-1",
      skillSlug: "review",
      status: "completed",
    }),
  // --- Snapshot procedures (Task 7) ---
  "planning.snapshot.create": () =>
    Effect.succeed({
      id: "stub-snapshot-1",
      workItemId: "stub-wi-1",
      stage: "planning",
      data: {},
    }),
  "planning.snapshot.list": () => Effect.succeed([]),
  "planning.snapshot.get": () => Effect.succeed(null),
  // --- Checkpoint procedures (Task 7) ---
  "planning.checkpoint.create": () =>
    Effect.succeed({
      id: "stub-cp-1",
      sessionId: "stub-session-1",
      turnNumber: 0,
      eventSeq: 0,
    }),
  "planning.checkpoint.list": () => Effect.succeed([]),
  "planning.checkpoint.branchFrom": () =>
    Effect.succeed({
      id: "stub-branch-session-1",
      userId: "stub-user-1",
    }),
});
