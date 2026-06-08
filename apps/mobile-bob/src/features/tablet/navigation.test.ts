import { describe, expect, it } from "vitest";

import {
  getMobileDetailBackAction,
  getMobileShellGlobalActions,
  getMobileShellModeActions,
  getMobilePlanningDashboardHref,
  getMobilePlanningFilterHref,
  getMobileTasksDashboardHref,
  getTabletDashboardHref,
  getTabletDashboardSelectionReset,
  getTabletPlanningSessionHref,
  getTabletProjectHref,
  getTabletProjectsHref,
  getTabletProviderHref,
  getTabletSettingsHref,
  getTabletSessionHref,
  getTabletTaskLaneHref,
  getTabletTaskLaneWorkItemHref,
  getTabletWorkItemHref,
  getMobileTaskTabHref,
} from "./navigation";

describe("tablet navigation", () => {
  it("returns to the mode dashboard and clears detail selection", () => {
    expect(getTabletDashboardHref()).toBe("/tasks");
    expect(getTabletDashboardHref("planning")).toBe("/planning");
    expect(getTabletDashboardHref("tasks", "workspace-1")).toBe(
      "/tasks?workspace=workspace-1",
    );
    expect(getTabletDashboardHref("planning", "workspace-1")).toBe(
      "/planning?workspace=workspace-1",
    );
    expect(getTabletDashboardSelectionReset()).toEqual({
      selectedSessionId: null,
      selectedWorkItemId: null,
    });
  });

  it("exposes phone routes for Tasks mode rail tabs", () => {
    expect(getMobileTaskTabHref("recent-outcomes")).toBe("/tasks/outcomes");
    expect(getMobileTaskTabHref("priority-queue")).toBe("/tasks/queue");
    expect(getMobileTaskTabHref("priority-queue", "workspace-1")).toBe(
      "/tasks/queue?workspace=workspace-1",
    );
  });

  it("exposes Planning first in the phone mode switch while defaulting to Tasks", () => {
    expect(getMobileShellModeActions("tasks", "workspace-1")).toEqual([
      {
        key: "planning",
        label: "Planning",
        href: "/planning?workspace=workspace-1",
        isActive: false,
      },
      {
        key: "tasks",
        label: "Tasks",
        href: "/tasks?workspace=workspace-1",
        isActive: true,
      },
    ]);
    expect(getMobileShellModeActions("planning")[0]?.href).toBe("/planning");
    expect(getMobileShellModeActions("planning")[0]?.isActive).toBe(true);
  });

  it("exposes a workspace-scoped phone settings action outside the mode switch", () => {
    expect(getMobileShellGlobalActions("workspace-1")).toEqual([
      {
        key: "settings",
        label: "Settings",
        href: "/settings?workspace=workspace-1",
        accessibilityLabel: "Open settings",
      },
    ]);
    expect(getMobileShellGlobalActions(null)[0]?.href).toBe("/settings");
  });

  it("preserves workspace on tablet dashboard drilldown routes", () => {
    expect(getTabletTaskLaneHref("ready", "workspace-1")).toBe(
      "/tasks?lane=ready&workspace=workspace-1",
    );
    expect(getTabletProviderHref("codex", "workspace-1")).toBe(
      "/providers/codex?workspace=workspace-1",
    );
    expect(getTabletProjectsHref("workspace-1", "setup-issues")).toBe(
      "/projects?filter=setup-issues&workspace=workspace-1",
    );
    expect(getMobilePlanningFilterHref("awaiting-input", "workspace-1")).toBe(
      "/planning?filter=awaiting-input&workspace=workspace-1",
    );
    expect(getTabletProjectHref("project-1", "workspace-1")).toBe(
      "/projects/project-1?workspace=workspace-1",
    );
    expect(getTabletSettingsHref("workspace-1")).toBe(
      "/settings?workspace=workspace-1",
    );
  });

  it("preserves task lane row target view when opening work item details", () => {
    expect(getTabletWorkItemHref("work-1", "outcome", "workspace-1")).toBe(
      "/work-items/work-1?view=outcome&workspace=workspace-1",
    );
    expect(getTabletWorkItemHref("work-2", "queue", "workspace-1")).toBe(
      "/work-items/work-2?view=queue&workspace=workspace-1",
    );
    expect(getTabletWorkItemHref("issue-1", "planning", "workspace-1")).toBe(
      "/work-items/issue-1?view=planning&workspace=workspace-1",
    );
    expect(
      getTabletTaskLaneWorkItemHref(
        { workItemId: "work-1", view: "outcome" },
        "workspace-1",
      ),
    ).toBe("/work-items/work-1?view=outcome&workspace=workspace-1");
    expect(
      getTabletTaskLaneWorkItemHref(
        { workItemId: "work-2", view: "queue" },
        "workspace-1",
      ),
    ).toBe("/work-items/work-2?view=queue&workspace=workspace-1");
  });

  it("preserves workspace when opening shell session detail routes", () => {
    expect(getTabletSessionHref("session-1", "workspace-1")).toBe(
      "/sessions/session-1?workspace=workspace-1",
    );
    expect(getTabletSessionHref("session-1")).toBe("/sessions/session-1");
    expect(getTabletPlanningSessionHref("plan-1", "workspace-1")).toBe(
      "/planning/sessions/plan-1?workspace=workspace-1",
    );
    expect(getTabletPlanningSessionHref("plan-1", null)).toBe(
      "/planning/sessions/plan-1",
    );
  });

  it("preserves workspace on phone dashboard back routes", () => {
    expect(getMobileTasksDashboardHref("workspace-1")).toBe(
      "/tasks?workspace=workspace-1",
    );
    expect(getMobileTasksDashboardHref(null)).toBe("/tasks");
    expect(getMobilePlanningDashboardHref("workspace-1")).toBe(
      "/planning?workspace=workspace-1",
    );
    expect(getMobilePlanningDashboardHref(undefined)).toBe("/planning");
  });

  it("returns phone detail screens to the source navigation surface", () => {
    expect(
      getMobileDetailBackAction({
        source: "work-item",
        view: "queue",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      label: "Priority Queue",
      accessibilityLabel: "Back to priority queue",
      href: "/tasks/queue?workspace=workspace-1",
    });
    expect(
      getMobileDetailBackAction({
        source: "work-item",
        view: "outcome",
      }),
    ).toEqual({
      label: "Recent Outcomes",
      accessibilityLabel: "Back to recent outcomes",
      href: "/tasks/outcomes",
    });
    expect(
      getMobileDetailBackAction({
        source: "work-item",
        view: "planning",
        workspaceId: "workspace-1",
      }),
    ).toEqual({
      label: "Planning",
      accessibilityLabel: "Back to planning",
      href: "/planning?workspace=workspace-1",
    });
    expect(
      getMobileDetailBackAction({
        source: "execution-session",
        workspaceId: "workspace-1",
      }),
    ).toMatchObject({
      label: "Tasks",
      href: "/tasks?workspace=workspace-1",
    });
    expect(
      getMobileDetailBackAction({
        source: "planning-session",
        workspaceId: "workspace-1",
      }),
    ).toMatchObject({
      label: "Planning",
      href: "/planning?workspace=workspace-1",
    });
  });
});
