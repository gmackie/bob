import { describe, expect, it } from "vitest";

import {
  buildShellSettingsActions,
  buildWorkspaceSwitchHref,
  selectCurrentWorkspace,
} from "../shell-settings-model";

describe("shell settings model", () => {
  it("includes workspace, account, provider, app, device, and logout actions", () => {
    expect(buildShellSettingsActions().map((action) => action.label)).toEqual([
      "Change Workspace",
      "Account Settings",
      "Provider Settings",
      "App Settings",
      "Device Settings",
      "Log Out",
    ]);
  });

  it("keeps settings action links scoped to the selected workspace", () => {
    expect(
      buildShellSettingsActions("workspace-1")
        .filter((action) => action.href)
        .map((action) => [action.key, action.href]),
    ).toEqual([
      ["account", "/settings?section=preferences&workspace=workspace-1"],
      ["providers", "/settings?section=git-providers&workspace=workspace-1"],
      ["app", "/settings?section=preferences&workspace=workspace-1"],
      ["device", "/settings?section=cookie-jar&workspace=workspace-1"],
    ]);
  });

  it("selects the current workspace from an explicit query value or the first membership", () => {
    const workspaces = [
      { id: "workspace-1", name: "First", slug: "first" },
      { id: "workspace-2", name: "Second", slug: "second" },
    ];

    expect(selectCurrentWorkspace(workspaces, "workspace-2")).toEqual(workspaces[1]);
    expect(selectCurrentWorkspace(workspaces, null)).toEqual(workspaces[0]);
    expect(selectCurrentWorkspace(workspaces, "missing")).toEqual(workspaces[0]);
    expect(selectCurrentWorkspace([], null)).toBeNull();
  });

  it("builds workspace switch links without losing the current route", () => {
    expect(buildWorkspaceSwitchHref("/tasks/queue?lane=ready", "workspace-1")).toBe(
      "/tasks/queue?lane=ready&workspace=workspace-1",
    );
    expect(buildWorkspaceSwitchHref("/planning?workspace=old", "workspace-2")).toBe(
      "/planning?workspace=workspace-2",
    );
  });
});
