// Phase 7B-4B Task 5 — Verify ProjectsRpc includes project core + workspace RPCs.
//
// After adding project/workspace parity procedures the group should have 58 total.

import { describe, expect, it } from "vitest";

import {
  ProjectsRpc,
  ProjectsGetRpc,
  ProjectsDiscoveryRpc,
  ProjectsUpdateAutomationSettingsRpc,
  ProjectsSetDefaultAgentRpc,
  ProjectsDismissDirRpc,
  ProjectsWorkspaceListRpc,
  ProjectsWorkspaceCreateRpc,
  ProjectsWorkspaceRenameRpc,
  ProjectsWorkspaceSetDefaultAgentRpc,
  ProjectsWorkspaceDeleteRpc,
} from "../groups/projects.js";

describe("ProjectsRpc group — project core + workspace (7B-4B Task 5)", () => {
  it("has 58 procedures total", () => {
    const tags = Array.from(ProjectsRpc.requests.keys());
    expect(tags.length).toBe(58);
  });

  it("includes the project core and workspace procedures by tag", () => {
    expect(ProjectsRpc.requests.get("projects.get")).toBe(ProjectsGetRpc);
    expect(ProjectsRpc.requests.get("projects.discovery")).toBe(
      ProjectsDiscoveryRpc,
    );
    expect(ProjectsRpc.requests.get("projects.updateAutomationSettings")).toBe(
      ProjectsUpdateAutomationSettingsRpc,
    );
    expect(ProjectsRpc.requests.has("projects.setDefaultAgent")).toBe(true);
    expect(ProjectsRpc.requests.get("projects.setDefaultAgent")).toBe(
      ProjectsSetDefaultAgentRpc,
    );
    expect(ProjectsRpc.requests.get("projects.dismissDir")).toBe(
      ProjectsDismissDirRpc,
    );
    expect(ProjectsRpc.requests.get("projects.workspace.list")).toBe(
      ProjectsWorkspaceListRpc,
    );
    expect(ProjectsRpc.requests.get("projects.workspace.create")).toBe(
      ProjectsWorkspaceCreateRpc,
    );
    expect(ProjectsRpc.requests.get("projects.workspace.rename")).toBe(
      ProjectsWorkspaceRenameRpc,
    );
    expect(ProjectsRpc.requests.has("projects.workspace.setDefaultAgent")).toBe(
      true,
    );
    expect(ProjectsRpc.requests.get("projects.workspace.setDefaultAgent")).toBe(
      ProjectsWorkspaceSetDefaultAgentRpc,
    );
    expect(ProjectsRpc.requests.get("projects.workspace.delete")).toBe(
      ProjectsWorkspaceDeleteRpc,
    );
  });

  it("preserves the original 4 procedures", () => {
    expect(ProjectsRpc.requests.has("projects.create")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.list")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.getBySlug")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.delete")).toBe(true);
  });
});
