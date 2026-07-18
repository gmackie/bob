import { describe, expect, it } from "vitest";

import {
  buildSidebarProjectSummaries,
  buildSidebarRailRows,
  buildSidebarTabBadges,
  getDefaultSidebarShellHref,
  getSidebarActiveTabKeyForPath,
  getSidebarModeForPath,
  getSidebarModeItems,
  getSidebarScopedHref,
  getSidebarModeTabs,
  getSidebarUtilityItems,
} from "../sidebar-nav-model";

describe("sidebar nav model", () => {
  it("selects Tasks mode for task, queue, and outcome routes", () => {
    expect(getSidebarModeForPath("/tasks")).toBe("tasks");
    expect(getSidebarModeForPath("/tasks/queue?lane=ready")).toBe("tasks");
    expect(getSidebarModeForPath("/runs")).toBe("tasks");
  });

  it("selects Planning mode for planning session and project routes", () => {
    expect(getSidebarModeForPath("/planning")).toBe("planning");
    expect(getSidebarModeForPath("/planning/projects")).toBe("planning");
    expect(getSidebarModeForPath("/planning/sessions/session-1")).toBe("planning");
    expect(getSidebarModeForPath("/projects/project-1")).toBe("planning");
  });

  it("preserves the source rail tab for work item detail routes", () => {
    expect(getSidebarActiveTabKeyForPath("/work-items/task-1", "view=queue")).toBe(
      "priority-queue",
    );
    expect(getSidebarActiveTabKeyForPath("/work-items/task-1", "view=outcome")).toBe(
      "recent-outcomes",
    );
    expect(getSidebarActiveTabKeyForPath("/sessions/session-1", "")).toBe(
      "recent-outcomes",
    );
  });

  it("exposes mode switch items and mode-scoped tabs", () => {
    expect(getDefaultSidebarShellHref()).toBe("/tasks");
    expect(getSidebarModeItems()).toEqual([
      { key: "planning", label: "Planning", href: "/planning", icon: "planning" },
      { key: "tasks", label: "Tasks", href: "/tasks", icon: "tasks" },
    ]);
    expect(getSidebarModeItems().map((item) => item.label)).not.toContain("Dashboard");
    expect(getSidebarModeItems().map((item) => item.icon)).not.toContain("dashboard");

    expect(getSidebarModeTabs("tasks").map((tab) => tab.label)).toEqual([
      "Recent Outcomes",
      "Priority Queue",
    ]);
    expect(getSidebarModeTabs("planning").map((tab) => tab.label)).toEqual([
      "Recent Sessions",
      "Projects",
    ]);
  });

  it("keeps global settings out of the left navigation rail", () => {
    expect(getSidebarUtilityItems().map((item) => item.label)).toEqual([
      "Pull Requests",
      "Nodes",
      "Hermes",
    ]);
    expect(getSidebarUtilityItems().find((item) => item.label === "Hermes")).toEqual({
      key: "hermes",
      label: "Hermes",
      href: "/hermes/",
    });
  });

  it("preserves workspace context for mode and tab navigation", () => {
    expect(getSidebarScopedHref("/tasks", "workspace-1")).toBe(
      "/tasks?workspace=workspace-1",
    );
    expect(getSidebarScopedHref("/planning", "workspace-1")).toBe(
      "/planning?workspace=workspace-1",
    );
    expect(getSidebarScopedHref("/runs?provider=codex", "workspace-1")).toBe(
      "/runs?provider=codex&workspace=workspace-1",
    );
    expect(getSidebarScopedHref("/nodes", "workspace-1")).toBe("/nodes");
    expect(getSidebarScopedHref("/hermes/", "workspace-1")).toBe("/hermes/");
  });

  it("builds realtime badge counts for mode-scoped rail tabs", () => {
    expect(
      buildSidebarTabBadges({
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
        ],
        planningSessions: [
          { id: "planning-active", status: "running" },
          { id: "planning-complete", status: "completed" },
          { id: "planning-failed", status: "failed" },
        ],
        projects: [{ id: "project-1" }, { id: "project-2" }],
      }),
    ).toEqual({
      "recent-outcomes": 1,
      "priority-queue": 1,
      "recent-sessions": 2,
      projects: 2,
    });
  });

  it("counts session-only execution outcomes in the Recent Outcomes badge", () => {
    const executionSessions = [
      {
        id: "run-only",
        status: "completed",
        agentType: "codex",
        sessionType: "execution",
        workspaceId: "workspace-1",
        createdAt: "2026-05-31T12:00:00.000Z",
      },
    ];

    expect(
      buildSidebarTabBadges({
        workItems: [],
        executionSessions,
        planningSessions: [],
        projects: [],
      })["recent-outcomes"],
    ).toBe(1);
    expect(
      buildSidebarRailRows({
        tab: "recent-outcomes",
        now: new Date("2026-05-31T12:02:00.000Z"),
        workItems: [],
        executionSessions,
        planningSessions: [],
        projects: [],
      }),
    ).toEqual([
      {
        id: "run-only",
        title: "codex session",
        statusLabel: "Completed",
        statusTone: "success",
        agentLabel: "Codex",
        lastUpdatedLabel: "2m ago",
        href: "/sessions/run-only?workspace=workspace-1",
      },
    ]);
  });

  it("builds navigation rows with status, provider, and last-updated context", () => {
    const rows = buildSidebarRailRows({
      tab: "recent-outcomes",
      now: new Date("2026-05-31T12:00:00.000Z"),
      workItems: [
        {
          id: "done",
          identifier: "BOB-1",
          title: "Completed task",
          kind: "task",
          status: "completed",
          workspaceId: "workspace-1",
          completedAt: "2026-05-31T11:45:00.000Z",
          agentStatus: {
            sessionId: "session-1",
            status: "stopped",
            agentType: "codex",
          },
        },
      ],
      planningSessions: [],
      projects: [],
    });

    expect(rows).toEqual([
      {
        id: "done",
        title: "BOB-1 · Completed task",
        statusLabel: "Completed",
        statusTone: "success",
        agentLabel: "Codex",
        lastUpdatedLabel: "15m ago",
        href: "/work-items/done?view=outcome&workspace=workspace-1",
      },
    ]);

    expect(
      buildSidebarRailRows({
        tab: "recent-sessions",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [],
        planningSessions: [
          {
            id: "plan-1",
            title: "Rework dashboard",
            status: "failed",
            workspaceId: "workspace-1",
            planningProjectName: "Bob",
            draftCount: 3,
            producedTaskCount: 2,
            updatedAt: "2026-05-31T10:00:00.000Z",
          },
        ],
        projects: [],
      }),
    ).toEqual([
      {
        id: "plan-1",
        title: "Rework dashboard",
        statusLabel: "Failed",
        statusTone: "danger",
        agentLabel: "Bob",
        detailLabel: "3 drafts · 2 tasks",
        lastUpdatedLabel: "2h ago",
        href: "/planning/sessions/plan-1?workspace=workspace-1",
      },
    ]);
  });

  it("includes failed and interrupted work in Recent Outcomes rail rows", () => {
    expect(
      buildSidebarRailRows({
        tab: "recent-outcomes",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [
          {
            id: "failed",
            identifier: "BOB-4",
            title: "Failed execution",
            kind: "task",
            status: "failed",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:58:00.000Z",
            agentStatus: {
              sessionId: "session-4",
              status: "failed",
              agentType: "cursor",
            },
          },
          {
            id: "interrupted",
            identifier: "BOB-5",
            title: "Interrupted execution",
            kind: "task",
            status: "ready",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:59:30.000Z",
            agentStatus: {
              sessionId: "session-5",
              status: "interrupted",
              agentType: "codex",
            },
          },
        ],
        planningSessions: [],
        projects: [],
      }),
    ).toEqual([
      {
        id: "interrupted",
        title: "BOB-5 · Interrupted execution",
        statusLabel: "Interrupted",
        statusTone: "danger",
        agentLabel: "Codex",
        lastUpdatedLabel: "Just now",
        href: "/work-items/interrupted?view=outcome&workspace=workspace-1",
      },
      {
        id: "failed",
        title: "BOB-4 · Failed execution",
        statusLabel: "Failed",
        statusTone: "danger",
        agentLabel: "Cursor",
        lastUpdatedLabel: "2m ago",
        href: "/work-items/failed?view=outcome&workspace=workspace-1",
      },
    ]);
  });

  it("labels cancelled and stopped agent outcomes from the terminal session state", () => {
    expect(
      buildSidebarRailRows({
        tab: "recent-outcomes",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [
          {
            id: "cancelled",
            identifier: "BOB-6",
            title: "Cancelled execution",
            kind: "task",
            status: "ready",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:50:00.000Z",
            agentStatus: {
              sessionId: "session-6",
              status: "cancelled",
              agentType: "codex",
            },
          },
          {
            id: "stopped",
            identifier: "BOB-7",
            title: "Stopped execution",
            kind: "task",
            status: "ready",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:55:00.000Z",
            agentStatus: {
              sessionId: "session-7",
              status: "stopped",
              agentType: "cursor",
            },
          },
        ],
        planningSessions: [],
        projects: [],
      }).map((row) => [row.id, row.statusLabel]),
    ).toEqual([
      ["stopped", "Stopped"],
      ["cancelled", "Cancelled"],
    ]);
  });

  it("routes project rail rows into project configuration management", () => {
    expect(
      buildSidebarRailRows({
        tab: "projects",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [],
        planningSessions: [],
        projects: [
          {
            id: "project-1",
            key: "BOB",
            name: "Bob",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        id: "project-1",
        title: "BOB · Bob",
        statusLabel: "Project",
        statusTone: "default",
        agentLabel: "Config",
        lastUpdatedLabel: "1h ago",
        href: "/projects/project-1?tab=settings&workspace=workspace-1#project-settings",
      },
    ]);
  });

  it("uses the selected workspace as a fallback for rail row links", () => {
    expect(
      buildSidebarRailRows({
        tab: "priority-queue",
        workspaceId: "workspace-selected",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [
          {
            id: "ready",
            identifier: "BOB-8",
            title: "Ready task",
            kind: "task",
            status: "ready",
            updatedAt: "2026-05-31T11:50:00.000Z",
          },
        ],
        planningSessions: [],
        projects: [],
      }),
    ).toEqual([
      {
        id: "ready",
        title: "BOB-8 · Ready task",
        statusLabel: "No Priority",
        statusTone: "default",
        agentLabel: "Ready",
        lastUpdatedLabel: "10m ago",
        href: "/work-items/ready?view=queue&workspace=workspace-selected",
      },
    ]);

    expect(
      buildSidebarRailRows({
        tab: "recent-sessions",
        workspaceId: "workspace-selected",
        now: new Date("2026-05-31T12:00:00.000Z"),
        workItems: [],
        planningSessions: [
          {
            id: "plan-2",
            title: "Completed plan",
            status: "completed",
            updatedAt: "2026-05-31T11:00:00.000Z",
          },
        ],
        projects: [],
      })[0]?.href,
    ).toBe("/planning/sessions/plan-2?workspace=workspace-selected");
  });

  it("preserves workspace context when normalizing project rail summaries", () => {
    expect(
      buildSidebarProjectSummaries([
        {
          project: {
            id: "project-1",
            key: "BOB",
            name: "Bob",
            workspaceId: "workspace-1",
            updatedAt: "2026-05-31T11:00:00.000Z",
          },
        },
        {
          project: null,
        },
      ]),
    ).toEqual([
      {
        id: "project-1",
        key: "BOB",
        name: "Bob",
        workspaceId: "workspace-1",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
    ]);
  });
});
