import { describe, expect, it } from "vitest";

import {
  buildMobileWorkItemEntryRunRows,
  getMobileWorkItemEntryAction,
  buildMobileReadableOutcomeRows,
  buildMobileWorkItemEntryItem,
  buildMobileWorkItemEntryContext,
  getMobileOutcomeWorkItemHref,
  getMobileWorkItemDispatchSuccessHref,
  getMobileQueueWorkItemHref,
  getMobileWorkItemEntryValidationState,
  selectLatestMobileSessionBackedOutcomeRun,
  normalizeMobileWorkItemEntryView,
} from "./work-item-entry";
import type { TabletQueueItem } from "./queue";

const workItem: TabletQueueItem = {
  id: "task-1",
  identifier: "P1-1008",
  title: "Competitive ecosystem positioning map",
  kind: "task",
  status: "completed",
  priority: "high",
  queueSortOrder: 3,
};

describe("mobile work item entry context", () => {
  it("normalizes unknown entry views to planning context", () => {
    expect(normalizeMobileWorkItemEntryView("queue")).toBe("queue");
    expect(normalizeMobileWorkItemEntryView("outcome")).toBe("outcome");
    expect(normalizeMobileWorkItemEntryView("unexpected")).toBe("planning");
    expect(normalizeMobileWorkItemEntryView(undefined)).toBe("planning");
  });

  it("builds queue-forward detail context", () => {
    expect(buildMobileWorkItemEntryContext({ view: "queue", workItem })).toEqual({
      sourceLabel: "Priority Queue",
      heading: "Task-forward detail",
      description: "Review priority, queue position, dependencies, and dispatch controls before starting work.",
      backLabel: "Priority Queue",
      facts: [
        { label: "Priority", value: "high" },
        { label: "Queue", value: "#3" },
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

  it("surfaces project context in queue-forward detail", () => {
    const context = buildMobileWorkItemEntryContext({
      view: "queue",
      workItem: {
        ...workItem,
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

  it("does not show task-forward queue controls for non-task work items", () => {
    expect(
      buildMobileWorkItemEntryContext({
        view: "queue",
        workItem: {
          ...workItem,
          kind: "issue",
        },
      }),
    ).toMatchObject({
      sourceLabel: "Planning",
      heading: "Work item detail",
      backLabel: "Planning",
      sections: [
        { key: "scope", label: "Scope" },
        { key: "project-context", label: "Project context" },
        { key: "discussion", label: "Discussion" },
        { key: "artifacts", label: "Artifacts" },
        { key: "planning-history", label: "Planning history" },
      ],
    });
  });

  it("builds outcome-forward detail context", () => {
    expect(
      buildMobileWorkItemEntryContext({
        view: "outcome",
        workItem: {
          ...workItem,
          agentStatus: {
            sessionId: "session-1",
            status: "completed",
            agentType: "codex",
          },
        },
      }),
    ).toEqual({
      sourceLabel: "Recent Outcomes",
      heading: "Session-forward detail",
      description: "Review the latest session outcome, readable output, artifacts, and follow-up controls.",
      backLabel: "Recent Outcomes",
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

  it("derives validation state for tablet task and outcome detail surfaces", () => {
    expect(
      getMobileWorkItemEntryValidationState([
        {
          id: "artifact-1",
          artifactRole: "verification",
          artifactType: "verification",
          metadata: { result: "passed" },
          summary: "All mobile checks passed.",
          title: "Verification run",
        },
      ]),
    ).toEqual({
      label: "Validation passed",
      detail: "All mobile checks passed.",
      tone: "positive",
    });

    expect(getMobileWorkItemEntryValidationState([])).toEqual({
      label: "Validation not started",
      detail: "No verification or review artifact is attached to the current task yet.",
      tone: "default",
    });
  });

  it("selects the latest linked outcome session and formats readable event rows", () => {
    expect(
      selectLatestMobileSessionBackedOutcomeRun([
        {
          id: "run-without-session",
          createdAt: "2026-05-30T10:00:00.000Z",
        },
        {
          id: "older",
          sessionId: "session-old",
          completedAt: "2026-05-30T10:30:00.000Z",
        },
        {
          id: "newer",
          sessionId: "session-new",
          updatedAt: "2026-05-30T11:00:00.000Z",
        },
      ]),
    ).toMatchObject({ id: "newer", sessionId: "session-new" });

    expect(
      buildMobileReadableOutcomeRows([
        {
          seq: 1,
          eventType: "message_final",
          direction: "agent",
          payload: {
            message: {
              content: [{ type: "text", text: "Finished the implementation" }],
            },
          },
        },
        {
          seq: 2,
          eventType: "tool_call",
          direction: "agent",
          payload: {
            name: "exec_command",
            arguments: JSON.stringify({ command: "pnpm test" }),
          },
        },
      ]),
    ).toEqual([
      {
        id: "1-message_final-agent",
        label: "Agent",
        text: "Finished the implementation",
      },
      {
        id: "2-tool_call-agent",
        label: "Tool Call",
        text: "exec_command: pnpm test",
      },
    ]);
  });

  it("preserves session state when adapting API work items for mobile entry detail", () => {
    expect(
      buildMobileWorkItemEntryItem({
        id: "task-2",
        identifier: "P1-1009",
        title: "Stopped task",
        kind: "task",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 1,
        agentStatus: {
          sessionId: "session-stopped",
          status: "stopped",
          agentType: "codex",
        },
        dependencies: [
          {
            id: "dependency-1",
            identifier: "P1-1008",
            title: "Dependency",
            status: "completed",
          },
        ],
        dependents: [
          {
            id: "dependent-1",
            identifier: "P1-1010",
            title: "Dependent",
            status: "ready",
          },
        ],
      }),
    ).toEqual({
      id: "task-2",
      identifier: "P1-1009",
      title: "Stopped task",
      kind: "task",
      status: "ready",
      priority: "urgent",
      queueSortOrder: 1,
      agentStatus: {
        sessionId: "session-stopped",
        status: "stopped",
        agentType: "codex",
      },
      dependencies: [
        {
          id: "dependency-1",
          identifier: "P1-1008",
          title: "Dependency",
          status: "completed",
        },
      ],
      dependents: [
        {
          id: "dependent-1",
          identifier: "P1-1010",
          title: "Dependent",
          status: "ready",
        },
      ],
    });
  });

  it("uses terminal agent status for stale mobile outcome detail state", () => {
    expect(
      buildMobileWorkItemEntryContext({
        view: "outcome",
        workItem: {
          ...workItem,
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
      buildMobileWorkItemEntryContext({
        view: "outcome",
        workItem: {
          ...workItem,
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

  it("builds queue-forward detail sections", () => {
    expect(buildMobileWorkItemEntryContext({ view: "queue", workItem }).sections).toEqual([
      { key: "task-summary", label: "Task summary" },
      { key: "priority-queue", label: "Priority and queue" },
      { key: "dependencies-blockers", label: "Dependencies and blockers" },
      { key: "project-context", label: "Project context" },
      { key: "dispatch-controls", label: "Dispatch controls" },
      { key: "linked-sessions", label: "Linked sessions" },
      { key: "artifacts-validation", label: "Artifacts and validation" },
    ]);
  });

  it("summarizes dependencies and blocked dependents for queue details", () => {
    const context = buildMobileWorkItemEntryContext({
      view: "queue",
      workItem: {
        ...workItem,
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
      { label: "Priority", value: "high" },
      { label: "Queue", value: "#3" },
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

  it("keeps phone routes explicit about queue or outcome entry", () => {
    expect(getMobileQueueWorkItemHref("task-1")).toBe("/work-items/task-1?view=queue");
    expect(getMobileOutcomeWorkItemHref("task-1")).toBe("/work-items/task-1?view=outcome");
    expect(getMobileQueueWorkItemHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1?view=queue&workspace=workspace-1",
    );
    expect(getMobileOutcomeWorkItemHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1?view=outcome&workspace=workspace-1",
    );
  });

  it("offers a start action for dispatchable task-forward details", () => {
    expect(
      getMobileWorkItemEntryAction({
        view: "queue",
        workItem: {
          ...workItem,
          status: "ready",
        },
      }),
    ).toEqual({ kind: "dispatch", label: "Start work" });
  });

  it("offers a live-session action when task-forward details already have an active agent", () => {
    expect(
      getMobileWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          ...workItem,
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
      sessionId: "session-1",
      href: "/sessions/session-1?workspace=workspace-1",
    });

    expect(
      getMobileWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          ...workItem,
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
      sessionId: "session-2",
      href: "/sessions/session-2?workspace=workspace-1",
    });

    expect(
      getMobileWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          ...workItem,
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
      sessionId: "session-3",
      href: "/sessions/session-3?workspace=workspace-1",
    });

    expect(
      getMobileWorkItemEntryAction({
        view: "queue",
        workspaceId: "workspace-1",
        workItem: {
          ...workItem,
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
      sessionId: "session-4",
      href: "/sessions/session-4?workspace=workspace-1",
    });
  });

  it("offers a rerun action for completed task outcomes", () => {
    expect(
      getMobileWorkItemEntryAction({
        view: "outcome",
        workItem: {
          ...workItem,
          kind: "task",
          status: "completed",
        },
      }),
    ).toEqual({ kind: "rerun", label: "Rerun work" });
  });

  it("offers a rerun action for stale mobile outcomes with terminal agent state", () => {
    expect(
      getMobileWorkItemEntryAction({
        view: "outcome",
        workItem: {
          ...workItem,
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

  it("routes mobile dispatch success to the created session when available", () => {
    expect(
      getMobileWorkItemDispatchSuccessHref({
        workItemId: "task-1",
        workspaceId: "workspace-1",
        result: { sessionId: "session-1" },
      }),
    ).toBe("/sessions/session-1?workspace=workspace-1");

    expect(
      getMobileWorkItemDispatchSuccessHref({
        workItemId: "task-1",
        workspaceId: "workspace-1",
        result: {},
      }),
    ).toBe("/work-items/task-1/workspace?workspace=workspace-1");
  });

  it("builds routeable mobile execution run rows for task-forward details", () => {
    const rows = buildMobileWorkItemEntryRunRows(
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
