import { describe, expect, it } from "vitest";

import {
  buildWorkspaceSelectionPath,
  selectWorkspace,
} from "./workspace-selection";

describe("workspace selection", () => {
  it("returns the stored workspace when it exists", () => {
    const workspace = selectWorkspace({
      selectedWorkspaceId: "workspace-2",
      memberships: [
        { workspace: { id: "workspace-1", name: "Acme" } },
        { workspace: { id: "workspace-2", name: "Ops" } },
      ],
    });

    expect(workspace?.id).toBe("workspace-2");
  });

  it("prefers the route workspace when it exists", () => {
    const workspace = selectWorkspace({
      selectedWorkspaceId: "workspace-2",
      routeWorkspaceId: "workspace-1",
      memberships: [
        { workspace: { id: "workspace-1", name: "Acme" } },
        { workspace: { id: "workspace-2", name: "Ops" } },
      ],
    });

    expect(workspace?.id).toBe("workspace-1");
  });

  it("falls back to the first workspace when no stored workspace exists", () => {
    const workspace = selectWorkspace({
      selectedWorkspaceId: "missing",
      memberships: [
        { workspace: { id: "workspace-1", name: "Acme" } },
        { workspace: { id: "workspace-2", name: "Ops" } },
      ],
    });

    expect(workspace?.id).toBe("workspace-1");
  });

  it("builds route-backed workspace switch paths without losing existing params", () => {
    expect(buildWorkspaceSelectionPath("/settings", "workspace-1")).toBe(
      "/settings?workspace=workspace-1",
    );
    expect(buildWorkspaceSelectionPath("/tasks?lane=ready&workspace=old", "workspace-2")).toBe(
      "/tasks?lane=ready&workspace=workspace-2",
    );
  });
});

describe("default workspace, before anyone has chosen one", () => {
  // The list arrives newest-joined first. Taking element zero meant a
  // workspace made later for a side project became the default, so a fresh
  // install opened on an empty workspace with no daemon: "No host connected"
  // over "All clear", which reads as a broken app.
  const memberships = [
    { workspace: { id: "side-project", name: "LevelForge" }, joinedAt: "2026-07-21T03:00:51.381Z" },
    { workspace: { id: "main-workspace", name: "hetzner-bob" }, joinedAt: "2026-03-22T22:27:10.756Z" },
  ];

  it("picks the oldest membership, not the newest", () => {
    expect(
      selectWorkspace({ selectedWorkspaceId: null, memberships })?.id,
    ).toBe("main-workspace");
  });

  it("still lets a stored choice and a route win over the default", () => {
    expect(
      selectWorkspace({ selectedWorkspaceId: "side-project", memberships })?.id,
    ).toBe("side-project");
    expect(
      selectWorkspace({
        selectedWorkspaceId: "main-workspace",
        routeWorkspaceId: "side-project",
        memberships,
      })?.id,
    ).toBe("side-project");
  });

  it("falls back to the first entry when no timestamps are present", () => {
    expect(
      selectWorkspace({
        selectedWorkspaceId: null,
        memberships: [
          { workspace: { id: "a", name: "A" } },
          { workspace: { id: "b", name: "B" } },
        ],
      })?.id,
    ).toBe("a");
  });

  it("returns null when there are no memberships at all", () => {
    expect(selectWorkspace({ selectedWorkspaceId: null, memberships: [] })).toBeNull();
  });
});
