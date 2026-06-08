import { describe, expect, it } from "vitest";

import {
  getLegacyPlanningBoardRedirectHref,
  getPlanningDashboardHref,
  getPlanningProjectQueryRefreshOptions,
  getPlanningDispatchHref,
  getPlanningShellActions,
  getPlanningShellTabs,
  getPlanningShellTitle,
  getPlanningSessionHref,
  matchPlanningShellRoute,
  shouldRenderPlanningWorkspaceTabs,
} from "../planning-shell-model";

describe("planning shell model", () => {
  it("exposes Recent Sessions and Projects as the Planning mode tabs", () => {
    expect(getPlanningShellTabs()).toEqual([
      { href: "/planning", label: "Recent Sessions" },
      { href: "/planning/projects", label: "Projects" },
    ]);
  });

  it("keeps task queue drilldowns out of the Planning shell", () => {
    const tabHrefs = getPlanningShellTabs().map((tab) => tab.href) as string[];

    expect(matchPlanningShellRoute("/planning/board")).toBeNull();
    expect(matchPlanningShellRoute("/planning/board?lane=ready")).toBeNull();
    expect(tabHrefs).toEqual(["/planning", "/planning/projects"]);
  });

  it("redirects the legacy planning board route to the Tasks priority queue", () => {
    expect(getLegacyPlanningBoardRedirectHref()).toBe("/tasks/queue");
    expect(getLegacyPlanningBoardRedirectHref("lane=ready")).toBe("/tasks/queue?lane=ready");
    expect(getLegacyPlanningBoardRedirectHref("lane=active&workspace=workspace-1")).toBe(
      "/tasks/queue?lane=active&workspace=workspace-1",
    );
  });

  it("keeps planning session detail routes inside the Planning shell", () => {
    expect(matchPlanningShellRoute("/planning/sessions/session-1")).toBe("/planning/sessions");
    expect(getPlanningSessionHref("session-1")).toBe("/planning/sessions/session-1");
    expect(getPlanningSessionHref("session-1", "workspace-1")).toBe(
      "/planning/sessions/session-1?workspace=workspace-1",
    );
    expect(getPlanningShellTitle("/planning/sessions")).toEqual({
      heading: "Planning Session",
      subtitle: null,
    });
  });

  it("preserves workspace when linking back to the planning dashboard", () => {
    expect(getPlanningDashboardHref("workspace-1")).toBe("/planning?workspace=workspace-1");
    expect(getPlanningDashboardHref(null)).toBe("/planning");
  });

  it("preserves workspace when linking to planning dispatch batches", () => {
    expect(getPlanningDispatchHref("batch-1")).toBe("/planning/dispatch/batch-1");
    expect(getPlanningDispatchHref("batch-1", "workspace-1")).toBe(
      "/planning/dispatch/batch-1?workspace=workspace-1",
    );
  });

  it("uses Planning language for the default planning dashboard", () => {
    expect(getPlanningShellTitle("/planning")).toEqual({
      heading: "Planning",
      subtitle: null,
    });
    expect(getPlanningShellTitle("/planning/projects")).toEqual({
      heading: "Projects",
      subtitle: null,
    });
  });

  it("keeps planning session creation as a shell-level Planning action", () => {
    expect(getPlanningShellActions("/planning")).toEqual([
      { key: "start-planning-session", label: "+ Planning" },
    ]);
    expect(getPlanningShellActions("/planning/projects").map((action) => action.key)).toEqual([
      "import-github-project",
      "create-project",
    ]);
    expect(getPlanningShellActions("/planning/sessions")).toEqual([]);
  });

  it("keeps Planning workspace navigation in the left rail instead of duplicate page tabs", () => {
    expect(shouldRenderPlanningWorkspaceTabs()).toBe(false);
  });

  it("uses short polling as the web fallback for planning project status changes", () => {
    expect(getPlanningProjectQueryRefreshOptions()).toEqual({
      staleTime: 15_000,
      refetchInterval: 15_000,
    });
  });
});
