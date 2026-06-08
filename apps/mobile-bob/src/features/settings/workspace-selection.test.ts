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
