import { describe, expect, it } from "vitest";

import {
  buildPriorityQueueRows,
  buildPriorityQueueSaveOrder,
  canMovePriorityQueueRow,
  getPriorityQueueHeaderModel,
  getTaskDashboardHeaderModel,
  getPriorityQueueRowAction,
  getPriorityQueueSessionHref,
  getPriorityQueueHref,
  getPriorityQueueWorkItemHref,
  getTaskLaneHref,
  getTaskShellTabs,
  matchTaskShellRoute,
  movePriorityQueueRow,
  selectTaskDashboardWorkspace,
} from "../task-shell-model";

describe("task shell model", () => {
  it("keeps the Tasks dashboard header free of explanatory copy", () => {
    expect(getTaskDashboardHeaderModel()).toEqual({
      title: "Tasks",
      subtitle: null,
    });
  });

  it("selects a dashboard workspace from tRPC membership rows", () => {
    const memberships = [
      { workspace: { id: "workspace-1", name: "Hetzner" } },
      { workspace: { id: "workspace-2", name: "Lab NUC" } },
    ];

    expect(selectTaskDashboardWorkspace(memberships, "workspace-2")).toEqual({
      id: "workspace-2",
      name: "Lab NUC",
    });
    expect(selectTaskDashboardWorkspace(memberships, null)).toEqual({
      id: "workspace-1",
      name: "Hetzner",
    });
  });

  it("keeps the Priority Queue header free of explanatory copy", () => {
    expect(getPriorityQueueHeaderModel()).toEqual({
      title: "Priority Queue",
      subtitle: null,
    });
  });

  it("exposes task navigation tabs with design-plan labels", () => {
    expect(getTaskShellTabs()).toEqual([
      { href: "/runs", label: "Recent Outcomes" },
      { href: "/tasks/queue", label: "Priority Queue" },
    ]);
  });

  it("keeps task dashboard and queue routes in Tasks mode", () => {
    expect(matchTaskShellRoute("/tasks")).toBe("/tasks");
    expect(matchTaskShellRoute("/tasks/queue")).toBe("/tasks/queue");
    expect(matchTaskShellRoute("/runs")).toBe("/runs");
    expect(matchTaskShellRoute("/planning")).toBeNull();
  });

  it("keeps dashboard lane drilldowns in Tasks mode", () => {
    expect(getTaskLaneHref("ready")).toBe("/tasks/queue?lane=ready");
    expect(getTaskLaneHref("ready", "workspace-1")).toBe(
      "/tasks/queue?lane=ready&workspace=workspace-1",
    );
    expect(getPriorityQueueHref("workspace-1")).toBe("/tasks/queue?workspace=workspace-1");
    expect(matchTaskShellRoute("/tasks/queue?lane=ready")).toBe("/tasks/queue");
  });

  it("routes queue rows into task-forward work item details", () => {
    expect(getPriorityQueueWorkItemHref("task-1")).toBe("/work-items/task-1?view=queue");
    expect(getPriorityQueueWorkItemHref("task-1", "workspace-1")).toBe(
      "/work-items/task-1?view=queue&workspace=workspace-1",
    );
  });

  it("routes live queue sessions to the session workspace", () => {
    expect(getPriorityQueueSessionHref("session-1")).toBe("/sessions/session-1");
    expect(getPriorityQueueSessionHref("session-1", "workspace-1")).toBe(
      "/sessions/session-1?workspace=workspace-1",
    );
  });

  it("builds a linear priority queue and excludes completed outcomes", () => {
    const rows = buildPriorityQueueRows([
      {
        id: "done",
        identifier: "BOB-1",
        title: "Completed",
        status: "done",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "errored",
        identifier: "BOB-7",
        title: "Errored",
        status: "error",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "interrupted",
        identifier: "BOB-8",
        title: "Interrupted",
        status: "interrupted",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "active-status",
        identifier: "BOB-5",
        title: "Already running",
        status: "in_progress",
        priority: "urgent",
        queueSortOrder: 1,
      },
      {
        id: "active-agent",
        identifier: "BOB-6",
        title: "Has running agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 2,
        agentStatus: {
          sessionId: "session-1",
          status: "running",
          agentType: "codex",
        },
      },
      {
        id: "pending-agent",
        identifier: "BOB-15",
        title: "Has pending agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 6,
        agentStatus: {
          sessionId: "session-5",
          status: "pending",
          agentType: "codex",
        },
      },
      {
        id: "awaiting-agent",
        identifier: "BOB-16",
        title: "Has awaiting input agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 7,
        agentStatus: {
          sessionId: "session-6",
          status: "awaiting-input",
          agentType: "codex",
        },
      },
      {
        id: "awaiting-underscore-agent",
        identifier: "BOB-17",
        title: "Has awaiting input agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 8,
        agentStatus: {
          sessionId: "session-7",
          status: "awaiting_input",
          agentType: "cursor",
        },
      },
      {
        id: "blocked",
        identifier: "BOB-10",
        title: "Blocked task",
        status: "blocked",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "in-review",
        identifier: "BOB-11",
        title: "Review task",
        status: "in_review",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "failed-agent",
        identifier: "BOB-9",
        title: "Has failed agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 3,
        agentStatus: {
          sessionId: "session-2",
          status: "failed",
          agentType: "codex",
        },
      },
      {
        id: "stopped-agent",
        identifier: "BOB-13",
        title: "Has stopped agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 4,
        agentStatus: {
          sessionId: "session-3",
          status: "stopped",
          agentType: "codex",
        },
      },
      {
        id: "cancelled-agent",
        identifier: "BOB-14",
        title: "Has cancelled agent",
        status: "ready",
        priority: "urgent",
        queueSortOrder: 5,
        agentStatus: {
          sessionId: "session-4",
          status: "cancelled",
          agentType: "cursor",
        },
      },
      {
        id: "ready-issue",
        identifier: "BOB-12",
        title: "Ready issue",
        status: "ready",
        kind: "issue",
        priority: "urgent",
        queueSortOrder: 0,
      },
      {
        id: "low",
        identifier: "BOB-2",
        title: "Low priority",
        status: "ready",
        kind: "task",
        priority: "low",
        queueSortOrder: 1,
      },
      {
        id: "urgent",
        identifier: "BOB-3",
        title: "Urgent priority",
        status: "ready",
        kind: "task",
        priority: "urgent",
        queueSortOrder: 5,
      },
      {
        id: "high",
        identifier: "BOB-4",
        title: "High priority",
        status: "ready",
        kind: "task",
        priority: "high",
        queueSortOrder: 2,
      },
    ]);

    expect(rows.map((row) => row.id)).toEqual(["urgent", "high", "low"]);
  });

  it("builds a durable save order from the visible queue rows", () => {
    expect(
      buildPriorityQueueSaveOrder([
        { id: "urgent", identifier: "BOB-1", title: "Urgent", status: "ready" },
        { id: "high", identifier: "BOB-2", title: "High", status: "ready" },
      ]),
    ).toEqual(["urgent", "high"]);
  });

  it("moves priority queue rows up or down without losing the rest of the queue", () => {
    const rows = [
      { id: "urgent", identifier: "BOB-1", title: "Urgent", status: "ready" },
      { id: "high", identifier: "BOB-2", title: "High", status: "ready" },
      { id: "low", identifier: "BOB-3", title: "Low", status: "ready" },
    ];

    expect(movePriorityQueueRow(rows, "high", "up").map((row) => row.id)).toEqual([
      "high",
      "urgent",
      "low",
    ]);
    expect(movePriorityQueueRow(rows, "high", "down").map((row) => row.id)).toEqual([
      "urgent",
      "low",
      "high",
    ]);
    expect(movePriorityQueueRow(rows, "urgent", "up")).toEqual(rows);
    expect(movePriorityQueueRow(rows, "missing", "down")).toEqual(rows);
  });

  it("only manually reorders rows inside the same priority group", () => {
    const rows = [
      { id: "urgent", identifier: "BOB-1", title: "Urgent", status: "ready", priority: "urgent" },
      { id: "high-1", identifier: "BOB-2", title: "High one", status: "ready", priority: "high" },
      { id: "high-2", identifier: "BOB-3", title: "High two", status: "ready", priority: "high" },
      { id: "low", identifier: "BOB-4", title: "Low", status: "ready", priority: "low" },
    ];

    expect(canMovePriorityQueueRow(rows, "high-1", "up")).toBe(false);
    expect(canMovePriorityQueueRow(rows, "high-1", "down")).toBe(true);
    expect(canMovePriorityQueueRow(rows, "high-2", "up")).toBe(true);
    expect(canMovePriorityQueueRow(rows, "high-2", "down")).toBe(false);
    expect(movePriorityQueueRow(rows, "high-1", "up")).toEqual(rows);
    expect(movePriorityQueueRow(rows, "high-1", "down").map((row) => row.id)).toEqual([
      "urgent",
      "high-2",
      "high-1",
      "low",
    ]);
  });

  it("chooses live-session controls for active rows and dispatch controls for ready rows", () => {
    expect(
      getPriorityQueueRowAction({
        id: "live",
        identifier: "BOB-1",
        title: "Live",
        status: "ready",
        agentStatus: {
          sessionId: "session-1",
          status: "running",
          agentType: "codex",
        },
      }),
    ).toEqual({ kind: "live-session", sessionId: "session-1" });

    expect(
      getPriorityQueueRowAction({
        id: "pending",
        identifier: "BOB-4",
        title: "Pending",
        status: "ready",
        agentStatus: {
          sessionId: "session-4",
          status: "pending",
          agentType: "codex",
        },
      }),
    ).toEqual({ kind: "live-session", sessionId: "session-4" });

    expect(
      getPriorityQueueRowAction({
        id: "awaiting",
        identifier: "BOB-5",
        title: "Awaiting input",
        status: "ready",
        agentStatus: {
          sessionId: "session-5",
          status: "awaiting-input",
          agentType: "codex",
        },
      }),
    ).toEqual({ kind: "live-session", sessionId: "session-5" });

    expect(
      getPriorityQueueRowAction({
        id: "awaiting-underscore",
        identifier: "BOB-6",
        title: "Awaiting input",
        status: "ready",
        agentStatus: {
          sessionId: "session-6",
          status: "awaiting_input",
          agentType: "cursor",
        },
      }),
    ).toEqual({ kind: "live-session", sessionId: "session-6" });

    expect(
      getPriorityQueueRowAction({
        id: "ready",
        identifier: "BOB-2",
        title: "Ready",
        status: "ready",
      }),
    ).toEqual({ kind: "dispatch" });

    expect(
      getPriorityQueueRowAction({
        id: "review",
        identifier: "BOB-3",
        title: "Review",
        status: "in_review",
      }),
    ).toEqual({ kind: "none" });
  });
});
