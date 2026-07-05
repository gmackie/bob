import { describe, expect, it } from "vitest";

import { assertDefined } from "~/lib/assert";
import {
  buildMobileProjectAutomationControls,
  buildMobileProjectConfigurationManagementGroups,
  buildMobileProjectConfigurationSections,
  buildMobileProjectRailRows,
  filterMobileProjectStatusRows,
  getMobileProjectQueryRefreshOptions,
  getMobileProjectsDashboardHeaderModel,
  getMobileProjectDashboardColumns,
  buildMobileProjectStatusRows,
} from "./project-status";

describe("mobile project status model", () => {
  it("keeps the Projects dashboard header free of explanatory copy", () => {
    expect(getMobileProjectsDashboardHeaderModel()).toEqual({
      title: "Projects",
      subtitle: null,
    });
  });

  it("uses short polling as the mobile fallback for project status changes", () => {
    expect(getMobileProjectQueryRefreshOptions()).toEqual({
      refetchInterval: 15_000,
    });
  });

  it("summarizes project setup state for the Projects tab", () => {
    const rows = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Acme App",
            key: "ACME",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
          counts: { active: 2, tasks: 7, issues: 4 },
          linkedRepository: {
            path: "/repos/acme-app",
            branch: "feature/tablet-dashboard",
            mainBranch: "main",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "acme-app",
            buildSystem: "pnpm",
            dirty: true,
            stale: false,
          },
        },
        {
          project: {
            id: "project-2",
            name: "Ops Console",
            key: "OPS",
            planningProvider: "internal",
            linearProjectId: null,
            automationSettings: {},
          },
          counts: { active: 0, tasks: 1, issues: 1 },
          linkedRepository: null,
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      id: "project-1",
      title: "ACME · Acme App",
      workspaceName: "Acme Workspace",
      directory: "/repos/acme-app",
      repository: "github/acme/acme-app",
      gitStatus: "Dirty",
      branchLabel: "feature/tablet-dashboard (default main)",
      buildSystem: "pnpm",
      linearStatus: "Connected",
      configStatus: "Configured",
      activityLabel: "7 tasks · 4 issues · 2 active",
      warningLabel: "Dirty workspace",
    });
    expect(rows[1]).toMatchObject({
      directory: "Not mapped",
      repository: "No repository",
      gitStatus: "Missing repo",
      branchLabel: "No branch",
      buildSystem: "Unknown",
      linearStatus: "Not connected",
      configStatus: "Needs setup",
      warningLabel: "Missing repository, Missing Linear link",
    });
  });

  it("keeps project warnings structured for filtering and realtime row updates", () => {
    const rows = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Ops Console",
            key: "OPS",
            planningProvider: "internal",
            automationSettings: {},
          },
          linkedRepository: null,
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      warningLabel: "Missing repository, Missing Linear link",
      warnings: ["Missing repository", "Missing Linear link"],
    });
  });

  it("projects mobile Projects rail rows with status tone and last updated labels", () => {
    const rows = buildMobileProjectRailRows({
      workspaceName: "Acme Workspace",
      now: new Date("2026-05-31T12:00:00.000Z"),
      projects: [
        {
          project: {
            id: "healthy",
            name: "Healthy App",
            key: "OK",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
            updatedAt: "2026-05-31T11:55:00.000Z",
          },
          linkedRepository: {
            path: "/repos/healthy",
            branch: "main",
            mainBranch: "main",
          },
        },
        {
          project: {
            id: "setup",
            name: "Needs Setup",
            key: "SET",
            planningProvider: "linear",
            automationSettings: {},
            updatedAt: "2026-05-31T10:00:00.000Z",
          },
          counts: { active: 0, tasks: 2, issues: 1 },
          linkedRepository: null,
        },
      ],
    });

    expect(rows).toEqual([
      {
        id: "healthy",
        title: "OK · Healthy App",
        statusLabel: "Configured",
        statusTone: "success",
        detailLabel: "Ready",
        activityLabel: "0 tasks · 0 issues · 0 active",
        lastUpdatedLabel: "5m ago",
        accessibilityLabel: "OK · Healthy App, Configured, updated 5m ago",
      },
      {
        id: "setup",
        title: "SET · Needs Setup",
        statusLabel: "Needs setup",
        statusTone: "warning",
        detailLabel: "Missing repository, Missing Linear link",
        activityLabel: "2 tasks · 1 issues · 0 active",
        lastUpdatedLabel: "2h ago",
        accessibilityLabel: "SET · Needs Setup, Needs setup, updated 2h ago",
      },
    ]);
  });

  it("exposes warnings as a first-class Projects dashboard column", () => {
    expect(getMobileProjectDashboardColumns().map((column) => column.label)).toEqual([
      "Project",
      "Workspace",
      "Directory",
      "Repository",
      "Branch",
      "Build",
      "Git",
      "Linear",
      "Config",
      "Warnings",
    ]);
  });

  it("marks stale repositories separately from clean repositories", () => {
    const rows = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Acme App",
            key: "ACME",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
          counts: { active: 0, tasks: 1, issues: 0 },
          linkedRepository: {
            path: "/repos/acme-app",
            branch: "main",
            mainBranch: "main",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "acme-app",
            buildSystem: "pnpm",
            dirty: false,
            stale: true,
          },
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      gitStatus: "Stale",
      branchLabel: "main",
      warningLabel: "Stale sync",
    });
  });

  it("surfaces auth and invalid-directory repository setup warnings", () => {
    const rows = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-auth",
            name: "Private App",
            key: "AUTH",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: {
            path: "/repos/private-app",
            branch: "main",
            mainBranch: "main",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "private-app",
            discoveryStatus: "auth_issue",
          },
        },
        {
          project: {
            id: "project-invalid",
            name: "Moved App",
            key: "MOVED",
            planningProvider: "linear",
            linearProjectId: "linear-2",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: {
            path: "/repos/moved-app",
            branch: "main",
            mainBranch: "main",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "moved-app",
            discoveryStatus: "invalid_dir",
          },
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      gitStatus: "Auth issue",
      warningLabel: "Auth issue",
    });
    expect(rows[1]).toMatchObject({
      gitStatus: "Invalid directory",
      warningLabel: "Invalid directory",
    });
  });

  it("builds tablet project configuration sections", () => {
    const [row] = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Acme App",
            key: "ACME",
            status: "active",
            workspaceId: "workspace-1",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: {
              autoDispatch: true,
              planning: { defaultAgent: "codex" },
              execution: { provider: "cursor" },
              env: { required: ["GITHUB_TOKEN"] },
            },
          },
          counts: { active: 2, tasks: 7, issues: 4 },
          linkedRepository: {
            path: "/repos/acme-app",
            branch: "main",
            mainBranch: "main",
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "acme-app",
            buildSystem: "pnpm",
            dirty: false,
            stale: false,
          },
        },
      ],
    });

    const definedRow = assertDefined(row);
    expect(definedRow).toBeDefined();

    const sections = buildMobileProjectConfigurationSections(definedRow);

    expect(sections.map((section) => section.title)).toEqual([
      "Bob Project",
      "Workspace",
      "Directory",
      "Git",
      "Linear",
      "Planning",
      "Execution",
      "Secrets",
      "Validation",
    ]);
    expect(sections.find((section) => section.key === "planning")?.items).toContainEqual({
      label: "Default agent",
      value: "codex",
    });
    expect(sections.find((section) => section.key === "execution")?.items).toContainEqual({
      label: "Auto dispatch",
      value: "Enabled",
    });
    expect(sections.find((section) => section.key === "secrets")?.items).toContainEqual({
      label: "Required env",
      value: "GITHUB_TOKEN",
    });
    expect(sections.find((section) => section.key === "validation")?.status).toBe("ready");
  });

  it("groups tablet project configuration sections with management actions", () => {
    const [row] = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Acme App",
            key: "ACME",
            status: "active",
            workspaceId: "workspace-1",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: {
              autoDispatch: true,
              planning: { defaultAgent: "codex" },
              execution: { provider: "cursor" },
              env: { required: ["GITHUB_TOKEN"] },
            },
          },
          linkedRepository: {
            path: "/repos/acme-app",
            branch: "main",
            mainBranch: "main",
          },
        },
      ],
    });

    const groups = buildMobileProjectConfigurationManagementGroups(
      buildMobileProjectConfigurationSections(assertDefined(row)),
    );

    expect(groups.map((group) => [group.key, group.actions.map((action) => action.label)])).toEqual([
      ["identity", ["Review project identity"]],
      ["repository-integrations", ["Map repository", "Connect Linear"]],
      ["planning-execution", ["Edit automation", "Review env references"]],
      ["validation", ["Review checks"]],
    ]);
    expect(groups.flatMap((group) => group.sections.map((section) => section.key))).toEqual([
      "metadata",
      "workspace",
      "directory",
      "git",
      "linear",
      "planning",
      "execution",
      "secrets",
      "validation",
    ]);
  });

  it("builds editable automation controls for project configuration", () => {
    expect(
      buildMobileProjectAutomationControls({
        autoDispatch: true,
        autoBranch: false,
        autoFeaturePR: true,
        ciTrigger: false,
      }),
    ).toEqual([
      {
        key: "autoDispatch",
        label: "Auto dispatch",
        description: "Start queued task work automatically when Bob can run it.",
        enabled: true,
      },
      {
        key: "autoBranch",
        label: "Auto branch",
        description: "Create execution branches for new task runs.",
        enabled: false,
      },
      {
        key: "autoFeaturePR",
        label: "Feature PR",
        description: "Open a pull request when implementation work is ready.",
        enabled: true,
      },
      {
        key: "ciTrigger",
        label: "CI trigger",
        description: "Run configured validation after agent changes.",
        enabled: false,
      },
    ]);
  });

  it("filters project rows for planning summary drilldowns", () => {
    const rows = buildMobileProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "healthy",
            name: "Healthy App",
            key: "OK",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: {
            path: "/repos/healthy",
            branch: "main",
            mainBranch: "main",
          },
        },
        {
          project: {
            id: "setup",
            name: "Needs Setup",
            key: "SET",
            planningProvider: "linear",
            automationSettings: {},
          },
          linkedRepository: null,
        },
        {
          project: {
            id: "stale",
            name: "Stale App",
            key: "OLD",
            planningProvider: "linear",
            linearProjectId: "linear-2",
            automationSettings: { autoDispatch: true },
          },
          linkedRepository: {
            path: "/repos/stale",
            branch: "main",
            mainBranch: "main",
            stale: true,
          },
        },
      ],
    });

    expect(filterMobileProjectStatusRows(rows, "setup-issues").map((row) => row.id)).toEqual([
      "setup",
    ]);
    expect(filterMobileProjectStatusRows(rows, "stale-sync").map((row) => row.id)).toEqual([
      "stale",
    ]);
    expect(filterMobileProjectStatusRows(rows, "healthy").map((row) => row.id)).toEqual([
      "healthy",
    ]);
    expect(filterMobileProjectStatusRows(rows, null)).toHaveLength(3);
  });
});
