import { describe, expect, it } from "vitest";

import {
  buildPlanningDashboardModel,
  buildTabletPlanningDashboardSessionRows,
  filterTabletPlanningDashboardSessions,
  formatTabletPlanningSessionOutputLabel,
  getPlanningDashboardNavigationActions,
  getPlanningDashboardComposerAction,
  getTabletPlanningDashboardHeaderModel,
  getPlanningLiveRailPresentation,
  buildTabletPlanningSessionRequestInput,
  normalizeTabletPlanningDashboardFilter,
  shouldShowPlanningDashboardModeActions,
  shouldShowPlanningActiveRailInline,
  shouldShowPlanningDashboardNavigationActions,
} from "./planning-dashboard";

describe("tablet planning dashboard model", () => {
  it("keeps the Planning dashboard header free of explanatory copy", () => {
    expect(getTabletPlanningDashboardHeaderModel()).toEqual({
      title: "Planning",
      subtitle: null,
    });
  });

  it("separates active planning sessions from recent planning outcomes", () => {
    const model = buildPlanningDashboardModel({
      sessions: [
        {
          sessionId: "active",
          status: "running",
          agentType: "planner",
          lastActivityAt: "2026-05-31T11:00:00.000Z",
        },
        {
          sessionId: "recent",
          status: "stopped",
          agentType: "planning",
          lastActivityAt: "2026-05-31T10:00:00.000Z",
        },
        {
          sessionId: "run",
          status: "running",
          agentType: "codex",
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
      ],
      projects: [
        { project: { id: "project-1" }, linkedRepository: { path: "/repo/project-1" } },
        { project: { id: "project-2" }, linkedRepository: null },
      ],
    });

    expect(model.activeSessions.map((session) => session.sessionId)).toEqual([
      "active",
    ]);
    expect(model.recentSessions.map((session) => session.sessionId)).toEqual([
      "recent",
    ]);
    expect(model.projectCount).toBe(2);
    expect(model.connectedProjectCount).toBe(1);
  });

  it("builds planning health cards for the dashboard center", () => {
    const model = buildPlanningDashboardModel({
      sessions: [
        {
          sessionId: "awaiting",
          status: "awaiting_input",
          agentType: "planner",
          sessionType: "planning",
          title: "Needs input",
          draftCount: 4,
          producedTaskCount: 1,
          lastActivityAt: "2026-05-31T11:00:00.000Z",
        },
        {
          sessionId: "done",
          status: "completed",
          agentType: "planning",
          title: "Done",
          draftCount: 1,
          lastActivityAt: "2026-05-31T10:00:00.000Z",
        },
      ],
      projects: [
        {
          project: {
            id: "healthy",
            name: "Healthy",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: { path: "/repo/healthy" },
        },
        {
          project: {
            id: "missing",
            name: "Missing",
            planningProvider: "linear",
            automationSettings: {},
          },
          linkedRepository: null,
        },
        {
          project: {
            id: "stale",
            name: "Stale",
            planningProvider: "linear",
            linearProjectId: "linear-2",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: { path: "/repo/stale", stale: true },
        },
      ],
    });

    expect(model.summaryCards.map((card) => [card.key, card.count, card.tone])).toEqual([
      ["drafts-awaiting-commit", 5, "warning"],
      ["plans-needing-input", 1, "warning"],
      ["project-setup-issues", 1, "danger"],
      ["stale-project-sync", 1, "warning"],
      ["healthy-projects", 1, "success"],
    ]);
    expect(model.summaryCards.map((card) => [card.key, card.target])).toEqual([
      ["drafts-awaiting-commit", { type: "planning-dashboard", filter: "drafts" }],
      ["plans-needing-input", { type: "planning-dashboard", filter: "awaiting-input" }],
      ["project-setup-issues", { type: "projects-dashboard", filter: "setup-issues" }],
      ["stale-project-sync", { type: "projects-dashboard", filter: "stale-sync" }],
      ["healthy-projects", { type: "projects-dashboard", filter: "healthy" }],
    ]);
  });

  it("formats planning session output counts for tablet dashboard rows", () => {
    expect(
      formatTabletPlanningSessionOutputLabel({
        draftCount: 3,
        producedTaskCount: 2,
      }),
    ).toBe("3 drafts · 2 tasks");
    expect(
      formatTabletPlanningSessionOutputLabel({
        draftCount: 0,
        producedTaskCount: 1,
      }),
    ).toBe("1 task");
    expect(
      formatTabletPlanningSessionOutputLabel({
        draftCount: null,
        producedTaskCount: 0,
      }),
    ).toBe("No drafts");
  });

  it("builds normalized planning dashboard session rows with status and last activity", () => {
    const rows = buildTabletPlanningDashboardSessionRows(
      [
        {
          sessionId: "awaiting",
          status: "awaiting_input",
          agentType: "planner",
          title: "Needs direction",
          draftCount: 2,
          producedTaskCount: 1,
          lastActivityAt: "2026-05-31T12:00:00.000Z",
        },
        {
          sessionId: "done",
          status: "completed",
          agentType: "planning",
          draftCount: 0,
          producedTaskCount: 0,
          lastActivityAt: "2026-05-31T11:03:00.000Z",
        },
      ],
      { now: new Date("2026-05-31T12:03:00.000Z") },
    );

    expect(rows).toEqual([
      {
        sessionId: "awaiting",
        title: "Needs direction",
        statusLabel: "Awaiting Input",
        statusTone: "warning",
        outputLabel: "2 drafts · 1 task",
        lastUpdatedLabel: "3m ago",
      },
      {
        sessionId: "done",
        title: "planning",
        statusLabel: "Completed",
        statusTone: "default",
        outputLabel: "No drafts",
        lastUpdatedLabel: "1h ago",
      },
    ]);
  });

  it("builds planning request input from the selected workspace and first project", () => {
    expect(
      buildTabletPlanningSessionRequestInput({
        workspaceId: "workspace-1",
        projects: [
          {
            project: {
              id: "project-1",
              name: "Bob Mobile",
            },
            linkedRepository: { path: "/repo/project-1" },
          },
        ],
        goal: "  Rework the dashboard flow  ",
      }),
    ).toEqual({
      workspaceId: "workspace-1",
      projectId: "project-1",
      projectName: "Bob Mobile",
      goal: "Rework the dashboard flow",
    });

    expect(
      buildTabletPlanningSessionRequestInput({
        workspaceId: "workspace-1",
        projects: [],
        goal: "Plan a release",
      }),
    ).toBeNull();
  });

  it("moves active planning sessions out of the inline right rail on phone widths", () => {
    expect(shouldShowPlanningActiveRailInline(390)).toBe(false);
    expect(shouldShowPlanningActiveRailInline(980)).toBe(true);
    expect(getPlanningLiveRailPresentation(390)).toBe("sheet");
    expect(getPlanningLiveRailPresentation(980)).toBe("rail");
  });

  it("filters planning sessions for summary-card drilldowns", () => {
    const sessions = [
      {
        sessionId: "drafts",
        status: "completed",
        agentType: "planning",
        draftCount: 2,
        lastActivityAt: "2026-05-31T10:00:00.000Z",
      },
      {
        sessionId: "awaiting",
        status: "awaiting_input",
        agentType: "planning",
        draftCount: 0,
        lastActivityAt: "2026-05-31T11:00:00.000Z",
      },
      {
        sessionId: "plain",
        status: "completed",
        agentType: "planning",
        draftCount: 0,
        lastActivityAt: "2026-05-31T12:00:00.000Z",
      },
    ];

    expect(normalizeTabletPlanningDashboardFilter("drafts")).toBe("drafts");
    expect(normalizeTabletPlanningDashboardFilter("unknown")).toBeNull();
    expect(filterTabletPlanningDashboardSessions(sessions, "drafts").map((session) => session.sessionId)).toEqual([
      "drafts",
    ]);
    expect(filterTabletPlanningDashboardSessions(sessions, "awaiting-input").map((session) => session.sessionId)).toEqual([
      "awaiting",
    ]);
    expect(filterTabletPlanningDashboardSessions(sessions, null)).toHaveLength(3);
  });

  it("exposes a compact planning composer action for standalone phone planning", () => {
    expect(getPlanningDashboardComposerAction(false)).toEqual({
      key: "start-planning-session",
      label: "+ Planning",
      nextOpen: true,
    });
    expect(getPlanningDashboardComposerAction(true)).toEqual({
      key: "hide-planning-session",
      label: "Hide",
      nextOpen: false,
    });
  });

  it("exposes phone planning navigation actions for recent sessions and projects", () => {
    expect(getPlanningDashboardNavigationActions()).toEqual([
      { key: "recent-sessions", label: "Recent Sessions", href: "/planning" },
      { key: "projects", label: "Projects", href: "/projects" },
    ]);
  });

  it("hides duplicate planning navigation actions inside the tablet shell", () => {
    expect(shouldShowPlanningDashboardModeActions({
      hasModeSwitch: true,
      isEmbeddedInShell: false,
    })).toBe(true);
    expect(shouldShowPlanningDashboardModeActions({
      hasModeSwitch: true,
      isEmbeddedInShell: true,
    })).toBe(false);
    expect(shouldShowPlanningDashboardModeActions({
      hasModeSwitch: false,
      isEmbeddedInShell: true,
    })).toBe(false);
    expect(shouldShowPlanningDashboardNavigationActions({
      isEmbeddedInShell: false,
      width: 744,
    })).toBe(true);
    expect(shouldShowPlanningDashboardNavigationActions({
      hasModeSwitch: true,
      isEmbeddedInShell: false,
      width: 744,
    })).toBe(false);
    expect(shouldShowPlanningDashboardNavigationActions({
      isEmbeddedInShell: true,
      width: 744,
    })).toBe(false);
    expect(shouldShowPlanningDashboardNavigationActions({
      isEmbeddedInShell: true,
      width: 1133,
    })).toBe(false);
  });
});
