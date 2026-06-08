import { describe, expect, it } from "vitest";

import {
  buildPlanningDashboardSessionRows,
  buildPlanningDashboardSummaryCards,
  buildPlanningSessionGroups,
  filterPlanningDashboardSessions,
  formatPlanningSessionOutputLabel,
  formatPlanningSessionStatus,
  getPlanningDashboardSections,
  getPlanningDashboardRecentSessionsHeader,
  normalizePlanningDashboardFilter,
  selectDefaultPlanningProject,
} from "../planning-dashboard-model";

describe("planning dashboard model", () => {
  it("keeps the Planning dashboard center scoped to summary cards and recent sessions", () => {
    expect(getPlanningDashboardSections()).toEqual([
      "summary-cards",
      "recent-sessions",
      "active-sessions-rail",
    ]);
    expect(getPlanningDashboardSections()).not.toContain("project-progress");
  });

  it("keeps the Recent Sessions section header free of explanatory copy", () => {
    expect(getPlanningDashboardRecentSessionsHeader(null)).toEqual({
      title: "Recent Sessions",
      subtitle: null,
    });
    expect(getPlanningDashboardRecentSessionsHeader("drafts")).toEqual({
      title: "Recent Sessions",
      subtitle: "Drafts Awaiting Commit",
    });
  });

  it("keeps only current planning work in the active sessions rail", () => {
    const groups = buildPlanningSessionGroups([
      { id: "running", status: "running", title: "Running plan" },
      { id: "starting", status: "starting", title: "Starting plan" },
      { id: "pending", status: "pending", title: "Pending plan" },
      { id: "awaiting", status: "awaiting_input", title: "Needs input" },
      { id: "idle", status: "idle", title: "Paused plan" },
      { id: "done", status: "completed", title: "Done plan" },
      { id: "failed", status: "failed", title: "Failed plan" },
    ]);

    expect(groups.active.map((session) => session.id)).toEqual([
      "running",
      "starting",
      "pending",
      "awaiting",
    ]);
    expect(groups.recent.map((session) => session.id)).toEqual([
      "idle",
      "done",
      "failed",
    ]);
  });

  it("orders active and recent planning rail groups by latest activity", () => {
    const groups = buildPlanningSessionGroups([
      {
        id: "older-active",
        status: "running",
        title: "Older active",
        updatedAt: "2026-05-31T10:00:00.000Z",
      },
      {
        id: "older-recent",
        status: "completed",
        title: "Older recent",
        updatedAt: "2026-05-31T09:00:00.000Z",
      },
      {
        id: "newer-active",
        status: "awaiting-input",
        title: "Newer active",
        updatedAt: "2026-05-31T12:00:00.000Z",
      },
      {
        id: "newer-recent",
        status: "failed",
        title: "Newer recent",
        updatedAt: "2026-05-31T11:00:00.000Z",
      },
    ]);

    expect(groups.active.map((session) => session.id)).toEqual([
      "newer-active",
      "older-active",
    ]);
    expect(groups.recent.map((session) => session.id)).toEqual([
      "newer-recent",
      "older-recent",
    ]);
  });

  it("formats planning session statuses for compact badges", () => {
    expect(formatPlanningSessionStatus("awaiting_input")).toBe("Awaiting Input");
    expect(formatPlanningSessionStatus("running")).toBe("Running");
  });

  it("formats planning session output counts for dashboard rows", () => {
    expect(formatPlanningSessionOutputLabel({ id: "both", draftCount: 3, producedTaskCount: 2 })).toBe(
      "3 drafts · 2 tasks",
    );
    expect(formatPlanningSessionOutputLabel({ id: "one-draft", draftCount: 1, producedTaskCount: 0 })).toBe(
      "1 draft",
    );
    expect(formatPlanningSessionOutputLabel({ id: "none", draftCount: 0, producedTaskCount: null })).toBe(
      "No drafts",
    );
  });

  it("projects planning sessions into active rail rows with status and activity labels", () => {
    const rows = buildPlanningDashboardSessionRows(
      [
        {
          id: "session-1",
          status: "awaiting_input",
          title: "  Launch plan  ",
          planningProjectName: "  Bob Mobile  ",
          draftCount: 2,
          producedTaskCount: 1,
          updatedAt: "2026-05-31T11:45:00.000Z",
        },
        {
          id: "session-2",
          status: "running",
          title: "",
          draftCount: 0,
          producedTaskCount: 0,
          createdAt: "2026-05-31T10:00:00.000Z",
        },
      ],
      {
        workspaceId: "workspace-1",
        now: new Date("2026-05-31T12:00:00.000Z"),
      },
    );

    expect(rows).toEqual([
      {
        id: "session-1",
        title: "Launch plan",
        projectLabel: "Bob Mobile",
        status: "awaiting_input",
        statusLabel: "Awaiting Input",
        statusTone: "warning",
        outputLabel: "2 drafts · 1 task",
        lastUpdatedLabel: "15m ago",
        href: "/planning/sessions/session-1?workspace=workspace-1",
      },
      {
        id: "session-2",
        title: "Untitled planning session",
        projectLabel: "Planning",
        status: "running",
        statusLabel: "Running",
        statusTone: "success",
        outputLabel: "No drafts",
        lastUpdatedLabel: "2h ago",
        href: "/planning/sessions/session-2?workspace=workspace-1",
      },
    ]);
  });

  it("selects the first workspace project for compact planning creation", () => {
    const project = selectDefaultPlanningProject([
      { project: { id: "project-1", name: "First Project" } },
      { project: { id: "project-2", name: "Second Project" } },
    ]);

    expect(project).toEqual({ id: "project-1", name: "First Project" });
    expect(selectDefaultPlanningProject([])).toBeNull();
  });

  it("summarizes planning health cards for dashboard center content", () => {
    const cards = buildPlanningDashboardSummaryCards({
      workspaceId: "workspace-1",
      sessions: [
        {
          id: "awaiting",
          status: "awaiting-input",
          title: "Needs input",
          draftCount: 2,
          producedTaskCount: 1,
        },
        {
          id: "done",
          status: "completed",
          title: "Done",
          draftCount: 3,
          producedTaskCount: 0,
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
          linkedRepository: {
            path: "/repo/healthy",
            discoveryStatus: "ok",
          },
        },
        {
          project: {
            id: "setup",
            name: "Needs setup",
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
          linkedRepository: {
            path: "/repo/stale",
            stale: true,
          },
        },
      ],
    });

    expect(cards.map((card) => [card.key, card.count, card.tone])).toEqual([
      ["drafts-awaiting-commit", 5, "warning"],
      ["plans-needing-input", 1, "warning"],
      ["project-setup-issues", 1, "danger"],
      ["stale-project-sync", 1, "warning"],
      ["healthy-projects", 1, "success"],
    ]);
    expect(cards.map((card) => [card.key, card.href])).toEqual([
      ["drafts-awaiting-commit", "/planning?filter=drafts&workspace=workspace-1"],
      ["plans-needing-input", "/planning?filter=awaiting-input&workspace=workspace-1"],
      ["project-setup-issues", "/planning/projects?filter=setup-issues&workspace=workspace-1"],
      ["stale-project-sync", "/planning/projects?filter=stale-sync&workspace=workspace-1"],
      ["healthy-projects", "/planning/projects?filter=healthy&workspace=workspace-1"],
    ]);
  });

  it("filters planning sessions for summary-card drilldowns", () => {
    const sessions = [
      {
        id: "drafts",
        status: "completed",
        title: "Drafted tasks",
        draftCount: 2,
      },
      {
        id: "awaiting",
        status: "awaiting_input",
        title: "Needs input",
        draftCount: 0,
      },
      {
        id: "plain",
        status: "completed",
        title: "Plain plan",
        draftCount: 0,
      },
    ];

    expect(normalizePlanningDashboardFilter("drafts")).toBe("drafts");
    expect(normalizePlanningDashboardFilter("unknown")).toBeNull();
    expect(filterPlanningDashboardSessions(sessions, "drafts").map((session) => session.id)).toEqual([
      "drafts",
    ]);
    expect(filterPlanningDashboardSessions(sessions, "awaiting-input").map((session) => session.id)).toEqual([
      "awaiting",
    ]);
    expect(filterPlanningDashboardSessions(sessions, null)).toHaveLength(3);
  });
});
