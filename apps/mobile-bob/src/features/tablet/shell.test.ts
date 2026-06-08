import { describe, expect, it } from "vitest";

import {
  getDefaultShellTarget,
  getLeftRailTabs,
  getShellHeaderStatusLabel,
  getShellModeItems,
  getRightRailTitle,
  getShellGlobalActions,
  getShellHeaderTitle,
  getShellModeForTarget,
  getShellSelectionIntent,
  getShellStateForPath,
  getPlanningPaneSession,
  buildRecentOutcomeRailRows,
  getRecentOutcomeTarget,
  getExecutionSessionShellState,
  isNativeTabletShellTarget,
  buildLeftRailTabBadges,
  buildShellSessionRows,
  buildTabletShellSessionsFromAgentRuns,
  groupShellSessions,
  matchesShellSessionStatusFilter,
  selectLeftRailTarget,
  switchShellMode,
} from "./shell";
import type { TabletShellSession } from "./shell";

const sessions: TabletShellSession[] = [
  {
    sessionId: "run-1",
    status: "running",
    agentType: "codex",
    title: "Implement queue reorder",
    lastActivityAt: "2026-05-31T10:00:00.000Z",
  },
  {
    sessionId: "run-2",
    status: "error",
    agentType: "cursor",
    title: "Fix mobile auth",
    lastActivityAt: "2026-05-31T09:00:00.000Z",
  },
  {
    sessionId: "plan-1",
    status: "awaiting_input",
    agentType: "planner",
    title: "Plan dashboard shell",
    lastActivityAt: "2026-05-31T11:00:00.000Z",
  },
  {
    sessionId: "plan-2",
    status: "stopped",
    agentType: "planning",
    title: "Prioritize projects",
    draftCount: 4,
    producedTaskCount: 1,
    lastActivityAt: "2026-05-31T08:00:00.000Z",
  },
];

describe("tablet shell model", () => {
  it("uses design-plan labels for each mode", () => {
    expect(getShellModeItems().map((item) => item.label)).toEqual([
      "Planning",
      "Tasks",
    ]);
    expect(getLeftRailTabs("tasks").map((tab) => tab.label)).toEqual([
      "Recent Outcomes",
      "Priority Queue",
    ]);
    expect(getLeftRailTabs("planning").map((tab) => tab.label)).toEqual([
      "Recent Sessions",
      "Projects",
    ]);
    expect(getRightRailTitle("tasks")).toBe("Running Now");
    expect(getRightRailTitle("planning")).toBe("Active Sessions");
  });

  it("switches mode to the correct default workspace target", () => {
    expect(switchShellMode("tasks")).toEqual({
      mode: "tasks",
      target: { type: "tasks-dashboard" },
      leftTab: "recent-outcomes",
    });
    expect(switchShellMode("planning")).toEqual({
      mode: "planning",
      target: { type: "planning-dashboard" },
      leftTab: "recent-sessions",
    });
    expect(getDefaultShellTarget("tasks")).toEqual({ type: "tasks-dashboard" });
    expect(getDefaultShellTarget("planning")).toEqual({ type: "planning-dashboard" });
  });

  it("keeps the selected workspace visible in the shell header status", () => {
    expect(getShellHeaderStatusLabel({
      workspaceName: "Acme Ops",
      connectionState: "connected",
      sessionCount: 3,
    })).toBe("Acme Ops · 3 sessions");
    expect(getShellHeaderStatusLabel({
      workspaceName: null,
      connectionState: "reconnecting",
      sessionCount: 0,
    })).toBe("Workspace · reconnecting");
  });

  it("keeps the top-left shell header limited to the Tasks and Planning mode switch", () => {
    expect(getShellHeaderTitle()).toBeNull();
    expect(getShellModeItems().map((item) => item.key)).toEqual([
      "planning",
      "tasks",
    ]);
    expect(getShellGlobalActions().map((action) => action.key)).toEqual([
      "settings",
    ]);
  });

  it("keeps the selected workspace visible in the global settings trigger", () => {
    expect(getShellGlobalActions("Acme Ops")).toEqual([
      { key: "settings", label: "Settings", detailLabel: "Acme Ops" },
    ]);
    expect(getShellGlobalActions(null)).toEqual([
      { key: "settings", label: "Settings", detailLabel: "Workspace" },
    ]);
  });

  it("routes left rail tab selections into the main workspace without leaving the shell", () => {
    expect(selectLeftRailTarget("tasks", "recent-outcomes")).toEqual({
      type: "tasks-dashboard",
    });
    expect(selectLeftRailTarget("tasks", "priority-queue")).toEqual({
      type: "tasks-dashboard",
    });
    expect(selectLeftRailTarget("planning", "recent-sessions")).toEqual({
      type: "planning-dashboard",
    });
    expect(selectLeftRailTarget("planning", "projects")).toEqual({
      type: "projects-dashboard",
    });
  });

  it("restores tablet shell targets from route-backed drilldowns", () => {
    expect(getShellStateForPath("/tasks/queue")).toEqual({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "tasks-dashboard" },
    });
    expect(getShellStateForPath("/providers/codex", { provider: "codex" })).toEqual({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "provider", provider: "codex" },
    });
    expect(getShellStateForPath("/tasks", { lane: "review" })).toEqual({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "task-lane", lane: "review" },
    });
    expect(getShellStateForPath("/work-items/work-1", { workItemId: "work-1", view: "outcome" })).toEqual({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "work-item", workItemId: "work-1", view: "outcome" },
    });
    expect(getShellStateForPath("/work-items/work-2", { workItemId: "work-2", view: "queue" })).toEqual({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "work-item", workItemId: "work-2", view: "queue" },
    });
    expect(getShellStateForPath("/sessions/session-1", { sessionId: "session-1" })).toEqual({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "execution-session", sessionId: "session-1" },
    });
    expect(getShellStateForPath("/planning/sessions/plan-1", { sessionId: "plan-1" })).toEqual({
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-session", sessionId: "plan-1" },
    });
    expect(getShellStateForPath("/projects/project-1", { projectId: "project-1" })).toEqual({
      mode: "planning",
      leftTab: "projects",
      target: { type: "project", projectId: "project-1" },
    });
    expect(getShellStateForPath("/settings")).toEqual({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "settings" },
    });
  });

  it("derives mode from selected targets", () => {
    expect(getShellModeForTarget({ type: "work-item", workItemId: "W1" })).toBe("tasks");
    expect(getShellModeForTarget({ type: "execution-session", sessionId: "S1" })).toBe("tasks");
    expect(getShellModeForTarget({ type: "planning-session", sessionId: "S2" })).toBe("planning");
    expect(getShellModeForTarget({ type: "project", projectId: "P1" })).toBe("planning");
    expect(getShellModeForTarget({ type: "settings" }, "planning")).toBe("planning");
    expect(getShellModeForTarget({ type: "settings" }, "tasks")).toBe("tasks");
  });

  it("routes work item session actions to execution sessions in Tasks mode", () => {
    expect(getExecutionSessionShellState("run-1")).toEqual({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "execution-session", sessionId: "run-1" },
    });
  });

  it("derives selected detail state from the active shell target", () => {
    expect(getShellSelectionIntent({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "work-item", workItemId: "work-1" },
    })).toEqual({
      selectedWorkItemId: "work-1",
      selectedSessionId: null,
      planningSessionId: null,
      workItemView: "outcome",
    });
    expect(getShellSelectionIntent({
      mode: "tasks",
      leftTab: "recent-outcomes",
      target: { type: "execution-session", sessionId: "run-1" },
    })).toEqual({
      selectedWorkItemId: null,
      selectedSessionId: "run-1",
      planningSessionId: null,
      workItemView: "planning",
    });
    expect(getShellSelectionIntent({
      mode: "planning",
      leftTab: "recent-sessions",
      target: { type: "planning-session", sessionId: "plan-1" },
    })).toEqual({
      selectedWorkItemId: null,
      selectedSessionId: null,
      planningSessionId: "plan-1",
      workItemView: "planning",
    });
    expect(getShellSelectionIntent({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "tasks-dashboard" },
    })).toEqual({
      selectedWorkItemId: null,
      selectedSessionId: null,
      planningSessionId: null,
      workItemView: "planning",
    });
    expect(getShellSelectionIntent({
      mode: "planning",
      leftTab: "projects",
      target: { type: "project", projectId: "project-1" },
    })).toEqual({
      selectedWorkItemId: null,
      selectedSessionId: null,
      planningSessionId: null,
      workItemView: "planning",
    });
  });

  it("restores planning-forward work item details from route state", () => {
    const state = getShellStateForPath(
      "/work-items/issue-1",
      { workItemId: "issue-1", view: "planning" },
    );

    expect(state).toEqual({
      mode: "tasks",
      leftTab: "priority-queue",
      target: { type: "work-item", workItemId: "issue-1", view: "planning" },
    });
    expect(getShellSelectionIntent(state)).toMatchObject({
      selectedWorkItemId: "issue-1",
      workItemView: "planning",
    });
  });

  it("keeps project navigation as native tablet shell targets", () => {
    expect(isNativeTabletShellTarget({ type: "projects-dashboard" })).toBe(true);
    expect(isNativeTabletShellTarget({ type: "project", projectId: "P1" })).toBe(true);
  });

  it("routes linked recent outcomes to session-forward work item details", () => {
    expect(
      getRecentOutcomeTarget({
        sessionId: "run-1",
        status: "stopped",
        agentType: "codex",
        workItemId: "work-1",
        title: "Finished task",
        lastActivityAt: "2026-05-31T10:00:00.000Z",
      }),
    ).toEqual({
      target: { type: "work-item", workItemId: "work-1" },
      entryView: "outcome",
      leftTab: "recent-outcomes",
    });
    expect(getRecentOutcomeTarget(sessions[1]!)).toEqual({
      target: { type: "execution-session", sessionId: "run-2" },
      entryView: null,
      leftTab: "recent-outcomes",
    });
  });

  it("includes destination targets in normalized live and history rail rows", () => {
    const rows = buildShellSessionRows([
      {
        sessionId: "run-with-work",
        status: "completed",
        agentType: "codex",
        workItemId: "work-1",
        title: "Finished task",
        lastActivityAt: "2026-05-31T10:00:00.000Z",
      },
      {
        sessionId: "run-only",
        status: "failed",
        agentType: "cursor",
        title: "Failed run",
        lastActivityAt: "2026-05-31T09:00:00.000Z",
      },
      {
        sessionId: "plan-1",
        status: "completed",
        agentType: "planner",
        sessionType: "planning",
        title: "Finished planning",
        lastActivityAt: "2026-05-31T08:00:00.000Z",
      },
    ]);

    expect(rows.map((row) => row.target)).toEqual([
      { type: "work-item", workItemId: "work-1" },
      { type: "execution-session", sessionId: "run-only" },
      { type: "planning-session", sessionId: "plan-1" },
    ]);
    expect(rows.map((row) => row.entryView)).toEqual(["outcome", null, null]);
  });

  it("resolves planning pane metadata from the selected planning session", () => {
    expect(getPlanningPaneSession(sessions, "plan-2")).toEqual({
      sessionId: "plan-2",
      status: "stopped",
      sessionType: null,
      title: "Prioritize projects",
    });
    expect(getPlanningPaneSession(sessions, "missing")).toEqual({
      sessionId: "missing",
      status: "unknown",
      sessionType: null,
      title: "",
    });
  });

  it("puts only current execution sessions in the tasks live rail", () => {
    const grouped = groupShellSessions(sessions);

    expect(grouped.tasksActive.map((session) => session.sessionId)).toEqual(["run-1"]);
    expect(grouped.recentOutcomes.map((session) => session.sessionId)).toEqual(["run-2"]);
    expect(grouped.planningActive.map((session) => session.sessionId)).toEqual(["plan-1"]);
    expect(grouped.recentPlanning.map((session) => session.sessionId)).toEqual(["plan-2"]);
  });

  it("treats hyphenated awaiting-input planning sessions as active live work", () => {
    const grouped = groupShellSessions([
      {
        sessionId: "plan-awaiting",
        status: "awaiting-input",
        agentType: "planner",
        sessionType: "planning",
        title: "Needs user input",
        lastActivityAt: "2026-05-31T12:00:00.000Z",
      },
    ]);

    expect(grouped.planningActive.map((session) => session.sessionId)).toEqual([
      "plan-awaiting",
    ]);
    expect(grouped.recentPlanning).toEqual([]);
  });

  it("builds realtime badge counts for tablet left rail tabs", () => {
    expect(
      buildLeftRailTabBadges({
        sessions,
        workItems: [
          {
            id: "done",
            identifier: "BOB-1",
            title: "Completed",
            kind: "task",
            status: "completed",
          },
          {
            id: "ready",
            identifier: "BOB-2",
            title: "Ready",
            kind: "task",
            status: "ready",
          },
          {
            id: "active",
            identifier: "BOB-3",
            title: "Active",
            kind: "task",
            status: "in_progress",
          },
          {
            id: "review",
            identifier: "BOB-4",
            title: "Ready for review",
            kind: "task",
            status: "in_review",
          },
        ],
        projects: [{ id: "project-1" }, { id: "project-2" }],
      }),
    ).toEqual({
      "recent-outcomes": 1,
      "priority-queue": 1,
      "recent-sessions": 1,
      projects: 2,
    });
  });

  it("counts session-only execution outcomes in the Recent Outcomes badge", () => {
    expect(
      buildLeftRailTabBadges({
        sessions: [
          {
            sessionId: "run-only",
            status: "completed",
            agentType: "codex",
            sessionType: "execution",
            title: "Completed session-only run",
            lastActivityAt: "2026-05-31T12:00:00.000Z",
          },
        ],
        workItems: [],
        projects: [],
      })["recent-outcomes"],
    ).toBe(1);
  });

  it("shows session-only execution outcomes in the Recent Outcomes rail rows", () => {
    const rows = buildRecentOutcomeRailRows({
      workspaceId: "workspace-1",
      workItems: [
        {
          id: "done-work",
          identifier: "BOB-1",
          title: "Finished work item",
          kind: "task",
          status: "completed",
          completedAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      sessions: [
        {
          sessionId: "linked-session",
          status: "completed",
          agentType: "codex",
          sessionType: "execution",
          workItemId: "done-work",
          title: "Linked duplicate",
          lastActivityAt: "2026-05-31T12:01:00.000Z",
        },
        {
          sessionId: "session-only",
          status: "failed",
          agentType: "cursor",
          sessionType: "execution",
          title: "Session only run",
          lastActivityAt: "2026-05-31T12:02:00.000Z",
        },
      ],
      now: new Date("2026-05-31T12:03:00.000Z"),
    });

    expect(rows.map((row) => [row.id, row.target])).toEqual([
      ["session:session-only", { type: "execution-session", sessionId: "session-only" }],
      ["work-item:done-work", { type: "work-item", workItemId: "done-work" }],
    ]);
    expect(rows.map((row) => [row.id, row.href])).toEqual([
      ["session:session-only", "/sessions/session-only?workspace=workspace-1"],
      ["work-item:done-work", "/work-items/done-work?view=outcome&workspace=workspace-1"],
    ]);
    expect(rows[0]).toMatchObject({
      title: "Session only run",
      statusLabel: "Failed",
      statusTone: "danger",
      agentLabel: "Cursor",
      lastUpdatedLabel: "1m ago",
      entryView: null,
    });
    expect(rows[1]).toMatchObject({
      title: "BOB-1 · Finished work item",
      statusLabel: "Completed",
      entryView: "outcome",
    });
  });

  it("normalizes agent runs into routeable shell sessions for phone outcome lists", () => {
    expect(
      buildTabletShellSessionsFromAgentRuns([
        {
          id: "run-1",
          sessionId: "session-1",
          status: "completed",
          agentType: "codex",
          completedAt: new Date("2026-05-31T12:00:00.000Z"),
          createdAt: "2026-05-31T11:00:00.000Z",
          session: { title: "Completed Codex run" },
        },
        {
          id: "run-2",
          sessionId: null,
          status: "failed",
          agentType: "cursor",
          createdAt: "2026-05-31T10:00:00.000Z",
          session: null,
        },
      ]),
    ).toEqual([
      {
        sessionId: "session-1",
        status: "completed",
        agentType: "codex",
        title: "Completed Codex run",
        lastActivityAt: "2026-05-31T12:00:00.000Z",
        workItemId: null,
        sessionType: "execution",
      },
    ]);
  });

  it("uses explicit session type before agent naming heuristics", () => {
    const grouped = groupShellSessions([
      {
        sessionId: "plan-on-codex",
        status: "running",
        agentType: "codex",
        sessionType: "planning",
        title: "Plan on Codex",
        lastActivityAt: "2026-05-31T12:00:00.000Z",
      },
      {
        sessionId: "task-on-planner",
        status: "running",
        agentType: "planner",
        sessionType: "execution",
        title: "Execute planner-named task",
        lastActivityAt: "2026-05-31T12:00:00.000Z",
      },
    ]);

    expect(grouped.planningActive.map((session) => session.sessionId)).toEqual([
      "plan-on-codex",
    ]);
    expect(grouped.tasksActive.map((session) => session.sessionId)).toEqual([
      "task-on-planner",
    ]);
  });

  it("projects rail rows with status tone and last updated labels", () => {
    const rows = buildShellSessionRows(sessions, {
      now: new Date("2026-05-31T09:05:00.000Z"),
    });

    expect(rows.find((row) => row.sessionId === "run-2")).toMatchObject({
      title: "Fix mobile auth",
      agentLabel: "Cursor",
      statusLabel: "Error",
      statusTone: "danger",
      lastUpdatedLabel: "5m ago",
    });
    expect(rows.find((row) => row.sessionId === "plan-2")).toMatchObject({
      agentLabel: "Planning",
      detailLabel: "4 drafts · 1 task",
      statusLabel: "Stopped",
      statusTone: "default",
      lastUpdatedLabel: "1h ago",
    });
  });

  it("normalizes hyphenated awaiting-input labels and tone for rail rows", () => {
    const rows = buildShellSessionRows(
      [
        {
          sessionId: "plan-awaiting",
          status: "awaiting-input",
          agentType: "planner",
          sessionType: "planning",
          title: "Needs input",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:00:30.000Z") },
    );

    expect(rows[0]).toMatchObject({
      statusLabel: "Awaiting Input",
      statusTone: "warning",
      lastUpdatedLabel: "Just now",
    });
  });

  it("marks interrupted execution rows as danger status", () => {
    const rows = buildShellSessionRows(
      [
        {
          sessionId: "run-interrupted",
          status: "interrupted",
          agentType: "cursor",
          sessionType: "execution",
          title: "Interrupted execution",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:01:00.000Z") },
    );

    expect(rows[0]).toMatchObject({
      statusLabel: "Interrupted",
      statusTone: "danger",
      lastUpdatedLabel: "1m ago",
    });
  });

  it("matches recent outcome filters against completed, cancelled, failed, and interrupted statuses", () => {
    expect(matchesShellSessionStatusFilter("completed", "completed")).toBe(true);
    expect(matchesShellSessionStatusFilter("done", "completed")).toBe(true);
    expect(matchesShellSessionStatusFilter("cancelled", "completed")).toBe(true);
    expect(matchesShellSessionStatusFilter("stopped", "completed")).toBe(true);
    expect(matchesShellSessionStatusFilter("idle", "completed")).toBe(true);

    expect(matchesShellSessionStatusFilter("failed", "failed")).toBe(true);
    expect(matchesShellSessionStatusFilter("error", "failed")).toBe(true);
    expect(matchesShellSessionStatusFilter("interrupted", "failed")).toBe(true);

    expect(matchesShellSessionStatusFilter("running", "running")).toBe(true);
    expect(matchesShellSessionStatusFilter("provisioning", "running")).toBe(true);
    expect(matchesShellSessionStatusFilter("pending", "running")).toBe(true);
    expect(matchesShellSessionStatusFilter("queued", "running")).toBe(true);
    expect(matchesShellSessionStatusFilter("completed", "failed")).toBe(false);
  });

  it("keeps pending execution sessions in the active rail with a warning tone", () => {
    const rows = buildShellSessionRows(
      [
        {
          sessionId: "run-pending",
          status: "pending",
          agentType: "codex",
          sessionType: "execution",
          title: "Pending execution",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:01:00.000Z") },
    );

    expect(matchesShellSessionStatusFilter("pending", "running")).toBe(true);
    expect(rows[0]).toMatchObject({
      statusLabel: "Pending",
      statusTone: "warning",
    });
  });

  it("keeps queued execution sessions in the active rail with a warning tone", () => {
    const rows = buildShellSessionRows(
      [
        {
          sessionId: "run-queued",
          status: "queued",
          agentType: "cursor",
          sessionType: "execution",
          title: "Queued execution",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:01:00.000Z") },
    );

    expect(matchesShellSessionStatusFilter("queued", "running")).toBe(true);
    expect(rows[0]).toMatchObject({
      statusLabel: "Queued",
      statusTone: "warning",
    });
  });
});
