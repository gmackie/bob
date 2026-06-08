import { describe, expect, it } from "vitest";

import {
  getProjectConfigurationHref,
  getProjectWorkItemHref,
  getProjectsDashboardHref,
  normalizeProjectDetailTab,
} from "../project-detail-tabs-model";

describe("project detail tabs model", () => {
  it("opens project configuration links directly on the settings tab", () => {
    expect(getProjectConfigurationHref("project-1")).toBe(
      "/projects/project-1?tab=settings#project-settings",
    );
    expect(getProjectConfigurationHref("project-1", "workspace-1")).toBe(
      "/projects/project-1?tab=settings&workspace=workspace-1#project-settings",
    );
  });

  it("preserves workspace when returning to the projects dashboard", () => {
    expect(getProjectsDashboardHref("workspace-1")).toBe(
      "/planning/projects?workspace=workspace-1",
    );
    expect(getProjectsDashboardHref(null)).toBe("/planning/projects");
  });

  it("routes project work items through source-aware shell details", () => {
    expect(getProjectWorkItemHref({ id: "task-1", kind: "task" }, "workspace-1")).toBe(
      "/work-items/task-1?view=queue&workspace=workspace-1",
    );
    expect(
      getProjectWorkItemHref({ id: "task-1", kind: "task", workspaceId: "workspace-1" }),
    ).toBe("/work-items/task-1?view=queue&workspace=workspace-1");
    expect(getProjectWorkItemHref({ id: "issue-1", kind: "issue" }, "workspace-1")).toBe(
      "/work-items/issue-1?workspace=workspace-1",
    );
    expect(getProjectWorkItemHref({ id: "epic-1", kind: "epic" })).toBe(
      "/work-items/epic-1",
    );
  });

  it("normalizes supported project detail tab query values", () => {
    expect(normalizeProjectDetailTab("settings")).toBe("settings");
    expect(normalizeProjectDetailTab("requirements")).toBe("requirements");
    expect(normalizeProjectDetailTab("unknown")).toBe("board");
    expect(normalizeProjectDetailTab(null)).toBe("board");
  });
});
