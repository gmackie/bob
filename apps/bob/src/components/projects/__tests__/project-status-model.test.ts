import { describe, expect, it } from "vitest";

import {
  buildProjectConfigurationManagementGroups,
  buildProjectConfigurationSections,
  getProjectStatusDashboardColumns,
  buildProjectStatusRows,
  filterProjectStatusRows,
  getProjectStatusRowHref,
} from "../project-status-model";

describe("project status model", () => {
  it("builds dense dashboard rows with repo, linear, config, and warnings", () => {
    const rows = buildProjectStatusRows({
      workspaceName: "Acme Workspace",
      projects: [
        {
          project: {
            id: "project-1",
            name: "Acme App",
            key: "ACME",
            workspaceId: "workspace-1",
            planningProvider: "linear",
            linearProjectId: "linear-1",
            automationSettings: { autoDispatch: true },
          },
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
            workspaceId: "workspace-1",
            planningProvider: "internal",
            linearProjectId: null,
            automationSettings: {},
          },
          linkedRepository: null,
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      id: "project-1",
      name: "Acme App",
      key: "ACME",
      workspaceName: "Acme Workspace",
      directory: "/repos/acme-app",
      repository: "github/acme/acme-app",
      gitStatus: "Dirty",
      branchLabel: "feature/tablet-dashboard (default main)",
      buildSystem: "pnpm",
      linearStatus: "Connected",
      configStatus: "Configured",
      warnings: ["Dirty workspace"],
    });
    expect(rows[1]).toMatchObject({
      directory: "Not mapped",
      repository: "No repository",
      gitStatus: "Missing repo",
      branchLabel: "No branch",
      buildSystem: "Unknown",
      linearStatus: "Not connected",
      configStatus: "Needs setup",
      warnings: ["Missing repository", "Missing Linear link"],
    });
  });

  it("marks stale repositories separately from clean repositories", () => {
    const rows = buildProjectStatusRows({
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
      warnings: ["Stale sync"],
    });
  });

  it("surfaces auth and invalid-directory repository setup warnings", () => {
    const rows = buildProjectStatusRows({
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
      warnings: ["Auth issue"],
    });
    expect(rows[1]).toMatchObject({
      gitStatus: "Invalid directory",
      warnings: ["Invalid directory"],
    });
  });

  it("builds Bob configuration sections for the project detail page", () => {
    const [projectEntry] = buildProjectStatusRows({
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
              env: { required: ["GITHUB_TOKEN", "LINEAR_API_KEY"] },
            },
          },
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
      ],
    });

    expect(projectEntry).toBeDefined();

    const sections = buildProjectConfigurationSections(projectEntry!);

    expect(sections.map((section) => section.title)).toEqual([
      "Bob Project",
      "Workspace Assignment",
      "Local Directory",
      "Git Repository",
      "Linear Mapping",
      "Planning Defaults",
      "Execution Settings",
      "Secrets & Env",
      "Validation Checks",
    ]);
    expect(sections.find((section) => section.key === "workspace")?.items).toContainEqual({
      label: "Workspace",
      value: "Acme Workspace",
    });
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
      value: "GITHUB_TOKEN, LINEAR_API_KEY",
    });
    expect(sections.find((section) => section.key === "validation")?.status).toBe("warning");
  });

  it("groups Bob configuration sections into the settings management surface", () => {
    const [projectEntry] = buildProjectStatusRows({
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
            remoteProvider: "github",
            remoteOwner: "acme",
            remoteName: "acme-app",
            buildSystem: "pnpm",
          },
        },
      ],
    });

    const sections = buildProjectConfigurationSections(projectEntry!);
    const groups = buildProjectConfigurationManagementGroups(sections);

    expect(groups.map((group) => group.title)).toEqual([
      "Project Identity",
      "Repository & Integrations",
      "Planning & Execution",
      "Validation",
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
    expect(groups.find((group) => group.key === "planning-execution")?.description).toContain(
      "planning defaults",
    );
    expect(groups.map((group) => [group.key, group.actions.map((action) => action.label)])).toEqual([
      ["identity", ["Review project identity"]],
      ["repository-integrations", ["Map repository", "Connect Linear"]],
      ["planning-execution", ["Edit automation", "Review env references"]],
      ["validation", ["Review checks"]],
    ]);
  });

  it("routes project dashboard rows into configuration management", () => {
    expect(getProjectStatusRowHref("project-1")).toBe(
      "/projects/project-1?tab=settings#project-settings",
    );
    expect(getProjectStatusRowHref("project-1", "workspace-1")).toBe(
      "/projects/project-1?tab=settings&workspace=workspace-1#project-settings",
    );
  });

  it("exposes workspace and build as first-class project dashboard columns", () => {
    expect(getProjectStatusDashboardColumns().map((column) => column.label)).toEqual([
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

  it("filters project dashboard rows for planning summary drilldowns", () => {
    const rows = buildProjectStatusRows({
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

    expect(filterProjectStatusRows(rows, "setup-issues").map((row) => row.id)).toEqual([
      "setup",
    ]);
    expect(filterProjectStatusRows(rows, "stale-sync").map((row) => row.id)).toEqual([
      "stale",
    ]);
    expect(filterProjectStatusRows(rows, "healthy").map((row) => row.id)).toEqual([
      "healthy",
    ]);
    expect(filterProjectStatusRows(rows, null)).toHaveLength(3);
  });
});
