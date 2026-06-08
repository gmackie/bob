import { describe, expect, it } from "vitest";

import {
  buildWorkItemEntryRunRows,
  getWorkItemEntryAction,
  getWorkItemEntryBreadcrumbs,
  getWorkItemEntryHref,
  getWorkItemEntryPlanSessionHref,
  getWorkItemEntryRelatedQueueHref,
  getWorkItemReviewHref,
  getWorkItemEntryValidationState,
  getWorkItemOutcomeSessionHref,
  buildWorkItemEntryContext,
  normalizeWorkItemEntryView,
  selectLatestSessionBackedOutcomeRun,
} from "../work-item-entry-model";

describe("work item entry model", () => {
  it("normalizes known entry views and defaults to planning", () => {
    expect(normalizeWorkItemEntryView("queue")).toBe("queue");
    expect(normalizeWorkItemEntryView("outcome")).toBe("outcome");
    expect(normalizeWorkItemEntryView("bad")).toBe("planning");
    expect(normalizeWorkItemEntryView(null)).toBe("planning");
  });

  it("builds queue-forward context for task details opened from Priority Queue", () => {
    const context = buildWorkItemEntryContext({
      view: "queue",
      workspaceId: "workspace-1",
      workItem: {
        kind: "task",
        priority: "high",
        queueSortOrder: 3,
      },
    });

    expect(context).toEqual({
      view: "queue",
      label: "Priority Queue",
      heading: "Task-forward detail",
      description: "Review priority, queue position, dependencies, and dispatch controls before starting work.",
      backHref: "/tasks/queue?workspace=workspace-1",
      workspaceId: "workspace-1",
      facts: [
        { label: "Priority", value: "High" },
        { label: "Queue", value: "3" },
        { label: "Dependencies", value: "No dependencies" },
        { label: "Blocking", value: "No blocked tasks" },
      ],
      sections: [
        { key: "task-summary", label: "Task summary" },
        { key: "priority-queue", label: "Priority and queue" },
        { key: "dependencies-blockers", label: "Dependencies and blockers" },
        { key: "project-context", label: "Project context" },
        { key: "dispatch-controls", label: "Dispatch controls" },
        { key: "linked-sessions", label: "Linked sessions" },
        { key: "artifacts-validation", label: "Artifacts and validation" },
      ],
      dependencySummary: {
        dependencies: [],
        dependents: [],
        dependencyStatus: "No dependencies",
        dependentStatus: "No blocked tasks",
      },
    });
  });

  it("surfaces project context in queue-forward task details", () => {
    const context = buildWorkItemEntryContext({
      view: "queue",
      workspaceId: "workspace-1",
      workItem: {
        kind: "task",
        priority: "high",
        queueSortOrder: 3,
        project: {
          id: "project-1",
          key: "P1",
          name: "PlayTrek GTM",
        },
      },
    });

    expect(context.facts).toContainEqual({
      label: "Project",
      value: "P1 · PlayTrek GTM",
    });
  });

  it("builds session-forward context for outcome entries", () => {
    const context = buildWorkItemEntryContext({
      view: "outcome",
      workspaceId: "workspace-1",
      workItem: {
        kind: "task",
        status: "completed",
        agentStatus: {
          sessionId: "session-1",
          status: "completed",
          agentType: "codex",
        },
      },
    });

    expect(context).toMatchObject({
      view: "outcome",
      label: "Recent Outcomes",
      heading: "Session-forward detail",
      backHref: "/runs?workspace=workspace-1",
      facts: [
        { label: "Status", value: "Completed" },
        { label: "Provider", value: "Codex" },
        { label: "Session", value: "session-1" },
      ],
      sections: [
        { key: "outcome-summary", label: "Outcome summary" },
        { key: "provider-agent", label: "Provider and agent" },
        { key: "timeline-events", label: "Timeline and events" },
        { key: "readable-output", label: "Readable output" },
        { key: "artifacts", label: "Artifacts" },
        { key: "validation-review", label: "Validation and review" },
        { key: "follow-up-controls", label: "Follow-up controls" },
        { key: "linked-task", label: "Linked task" },
      ],
    });
  });

  it("derives validation state for task and outcome detail surfaces", () => {
    expect(
      getWorkItemEntryValidationState([
        {
          id: "artifact-1",
          artifactRole: "verification",
          artifactType: "verification",
          metadata: { result: "failed" },
          summary: "Typecheck failed in the mobile app.",
          title: "Verification run",
        },
      ]),
    ).toEqual({
      label: "Validation failed",
      detail: "Typecheck failed in the mobile app.",
      tone: "critical",
    });

    expect(
      getWorkItemEntryValidationState([
        {
          id: "artifact-2",
          artifactRole: "review",
          artifactType: "pr",
          summary: "Ready for human review.",
          title: "Review artifact",
        },
      ]),
    ).toEqual({
      label: "Awaiting review",
      detail: "A review artifact is attached for the current handoff.",
      tone: "warning",
    });
  });

  it("uses terminal agent status for stale task outcome detail state", () => {
    expect(
      buildWorkItemEntryContext({
        view: "outcome",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-1",
            status: "stopped",
            agentType: "codex",
          },
        },
      }).facts,
    ).toEqual([
      { label: "Status", value: "Stopped" },
      { label: "Provider", value: "Codex" },
      { label: "Session", value: "session-1" },
    ]);

    expect(
      buildWorkItemEntryContext({
        view: "outcome",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "completed",
          agentStatus: {
            sessionId: "session-2",
            status: "stopped",
            agentType: "cursor",
          },
        },
      }).facts,
    ).toEqual([
      { label: "Status", value: "Completed" },
      { label: "Provider", value: "Cursor" },
      { label: "Session", value: "session-2" },
    ]);
  });

  it("builds source-aware breadcrumbs that preserve workspace context", () => {
    const queueContext = buildWorkItemEntryContext({
      view: "queue",
      workspaceId: "workspace-1",
      workItem: {
        kind: "task",
        priority: "high",
        queueSortOrder: 3,
      },
    });
    const outcomeContext = buildWorkItemEntryContext({
      view: "outcome",
      workspaceId: "workspace-1",
      workItem: {
        kind: "task",
        status: "completed",
      },
    });

    expect(
      getWorkItemEntryBreadcrumbs({
        context: queueContext,
        identifier: "P1-1008",
        project: { id: "project-1", key: "P1" },
        workspaceId: "workspace-1",
      }),
    ).toEqual([
      { label: "Priority Queue", href: "/tasks/queue?workspace=workspace-1" },
      { label: "P1", href: "/projects/project-1?workspace=workspace-1" },
      { label: "P1-1008" },
    ]);
    expect(
      getWorkItemEntryBreadcrumbs({
        context: outcomeContext,
        identifier: "P1-1008",
        workspaceId: "workspace-1",
      }),
    ).toEqual([
      { label: "Recent Outcomes", href: "/runs?workspace=workspace-1" },
      { label: "P1-1008" },
    ]);
  });

  it("preserves workspace for work-item detail related links", () => {
    expect(getWorkItemEntryHref("task-1", "planning", "workspace-1")).toBe(
      "/work-items/task-1?workspace=workspace-1",
    );
    expect(getWorkItemEntryHref("task-1", "queue", "workspace-1")).toBe(
      "/work-items/task-1?view=queue&workspace=workspace-1",
    );
    expect(getWorkItemEntryHref("task-1", "outcome", "workspace-1")).toBe(
      "/work-items/task-1?view=outcome&workspace=workspace-1",
    );
    expect(getWorkItemEntryRelatedQueueHref("task-2", "workspace-1")).toBe(
      "/work-items/task-2?view=queue&workspace=workspace-1",
    );
    expect(getWorkItemEntryPlanSessionHref("task-1", "session-1", "workspace-1")).toBe(
      "/work-items/task-1/plan/session-1?workspace=workspace-1",
    );
    expect(getWorkItemReviewHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1/review?workspace=workspace-1",
    );
    expect(getWorkItemReviewHref("task-1")).toBe("/work-items/task-1/review");
  });

  it("builds task-forward context with queue detail sections", () => {
    const context = buildWorkItemEntryContext({
      view: "queue",
      workItem: {
        kind: "task",
        priority: "high",
        queueSortOrder: 3,
      },
    });

    expect(context.sections).toEqual([
      { key: "task-summary", label: "Task summary" },
      { key: "priority-queue", label: "Priority and queue" },
      { key: "dependencies-blockers", label: "Dependencies and blockers" },
      { key: "project-context", label: "Project context" },
      { key: "dispatch-controls", label: "Dispatch controls" },
      { key: "linked-sessions", label: "Linked sessions" },
      { key: "artifacts-validation", label: "Artifacts and validation" },
    ]);
  });

  it("summarizes dependencies and blocked dependents for task-forward details", () => {
    const context = buildWorkItemEntryContext({
      view: "queue",
      workItem: {
        kind: "task",
        priority: "high",
        queueSortOrder: 3,
        dependencies: [
          {
            id: "blocked-by-1",
            identifier: "P1-1007",
            title: "Complete competitor matrix",
            status: "in_progress",
          },
          {
            id: "blocked-by-2",
            identifier: "P1-1006",
            title: "Confirm source data",
            status: "completed",
          },
        ],
        dependents: [
          {
            id: "blocks-1",
            identifier: "P1-1009",
            title: "Publish positioning summary",
            status: "ready",
          },
        ],
      },
    });

    expect(context.facts).toEqual([
      { label: "Priority", value: "High" },
      { label: "Queue", value: "3" },
      { label: "Dependencies", value: "1 open / 2 total" },
      { label: "Blocking", value: "1 task" },
    ]);
    expect(context.dependencySummary).toEqual({
      dependencies: [
        {
          id: "blocked-by-1",
          identifier: "P1-1007",
          title: "Complete competitor matrix",
          status: "in_progress",
          statusLabel: "In Progress",
        },
        {
          id: "blocked-by-2",
          identifier: "P1-1006",
          title: "Confirm source data",
          status: "completed",
          statusLabel: "Completed",
        },
      ],
      dependents: [
        {
          id: "blocks-1",
          identifier: "P1-1009",
          title: "Publish positioning summary",
          status: "ready",
          statusLabel: "Ready",
        },
      ],
      dependencyStatus: "1 open / 2 total",
      dependentStatus: "1 task",
    });
  });

  it("offers a start action for dispatchable task-forward details", () => {
    expect(
      getWorkItemEntryAction({
        view: "queue",
        workItem: {
          kind: "task",
          status: "ready",
        },
      }),
    ).toEqual({ kind: "dispatch", label: "Start work" });
  });

  it("offers a live-session action when task-forward details already have an active agent", () => {
    expect(
      getWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "in_progress",
          agentStatus: {
            sessionId: "session-1",
            status: "running",
            agentType: "codex",
          },
        },
      }),
    ).toEqual({
      kind: "live-session",
      label: "Open live session",
      href: "/sessions/session-1?workspace=workspace-1",
      sessionId: "session-1",
    });

    expect(
      getWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-2",
            status: "pending",
            agentType: "codex",
          },
        },
      }),
    ).toEqual({
      kind: "live-session",
      label: "Open live session",
      href: "/sessions/session-2?workspace=workspace-1",
      sessionId: "session-2",
    });

    expect(
      getWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-3",
            status: "awaiting-input",
            agentType: "codex",
          },
        },
      }),
    ).toEqual({
      kind: "live-session",
      label: "Open live session",
      href: "/sessions/session-3?workspace=workspace-1",
      sessionId: "session-3",
    });

    expect(
      getWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-4",
            status: "awaiting_input",
            agentType: "cursor",
          },
        },
      }),
    ).toEqual({
      kind: "live-session",
      label: "Open live session",
      href: "/sessions/session-4?workspace=workspace-1",
      sessionId: "session-4",
    });
  });

  it("offers a rerun action for completed task outcomes", () => {
    expect(
      getWorkItemEntryAction({
        view: "outcome",
        workItem: {
          kind: "task",
          status: "completed",
        },
      }),
    ).toEqual({ kind: "rerun", label: "Rerun work" });
  });

  it("offers a rerun action for stale task outcomes with terminal agent state", () => {
    expect(
      getWorkItemEntryAction({
        view: "outcome",
        workItem: {
          kind: "task",
          status: "ready",
          agentStatus: {
            sessionId: "session-1",
            status: "stopped",
            agentType: "codex",
          },
        },
      }),
    ).toEqual({ kind: "rerun", label: "Rerun work" });
  });

  it("selects the newest session-backed run for outcome readable output", () => {
    const run = selectLatestSessionBackedOutcomeRun([
      {
        id: "new-without-session",
        status: "completed",
        createdAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "older",
        sessionId: "session-old",
        status: "completed",
        createdAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "newer",
        sessionId: "session-new",
        status: "failed",
        completedAt: "2026-05-31T11:00:00.000Z",
        createdAt: "2026-05-31T09:00:00.000Z",
      },
    ]);

    expect(run?.id).toBe("newer");
    expect(getWorkItemOutcomeSessionHref(run!.sessionId!, "workspace-1")).toBe(
      "/sessions/session-new?workspace=workspace-1",
    );
  });

  it("builds routeable linked execution run rows for task-forward details", () => {
    const rows = buildWorkItemEntryRunRows(
      [
        {
          id: "run-old",
          sessionId: "session-old",
          status: "completed",
          agentType: "codex",
          createdAt: "2026-05-31T09:00:00.000Z",
        },
        {
          id: "run-recorded",
          status: "failed",
          agentType: "cursor",
          updatedAt: "2026-05-31T11:00:00.000Z",
        },
        {
          id: "run-new",
          sessionId: "session-new",
          status: "running",
          agentType: "codex",
          updatedAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      "workspace-1",
    );

    expect(rows).toEqual([
      {
        id: "run-new",
        label: "Codex run",
        statusLabel: "Running",
        runHref: "/runs/run-new?workspace=workspace-1",
        sessionHref: "/sessions/session-new?workspace=workspace-1",
        primaryHref: "/sessions/session-new?workspace=workspace-1",
        primaryActionLabel: "Open session",
      },
      {
        id: "run-recorded",
        label: "Cursor run",
        statusLabel: "Failed",
        runHref: "/runs/run-recorded?workspace=workspace-1",
        sessionHref: null,
        primaryHref: "/runs/run-recorded?workspace=workspace-1",
        primaryActionLabel: "Open run",
      },
      {
        id: "run-old",
        label: "Codex run",
        statusLabel: "Completed",
        runHref: "/runs/run-old?workspace=workspace-1",
        sessionHref: "/sessions/session-old?workspace=workspace-1",
        primaryHref: "/sessions/session-old?workspace=workspace-1",
        primaryActionLabel: "Open session",
      },
    ]);
  });
});
