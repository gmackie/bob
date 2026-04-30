// Phase 7B-4B Task 5 — Verify ProjectsRpc includes project core + workspace RPCs.
//
// After adding 8 new procedures the group should have 12 total (existing 4 + 8 new).

import { describe, expect, it } from "vitest";

import {
  ProjectsRpc,
  ProjectsGetRpc,
  ProjectsDiscoveryRpc,
  ProjectsUpdateAutomationSettingsRpc,
  ProjectsDismissDirRpc,
  ProjectsWorkspaceListRpc,
  ProjectsWorkspaceCreateRpc,
  ProjectsWorkspaceRenameRpc,
  ProjectsWorkspaceDeleteRpc,
} from "../groups/projects.js";

describe("ProjectsRpc group — project core + workspace (7B-4B Task 5)", () => {
  it("has 43 procedures total (4 existing + 8 Task 5 + 12 Task 6 + 19 Task 7)", () => {
    const tags = Array.from(ProjectsRpc.requests.keys());
    expect(tags.length).toBe(43);
  });

  it("includes the 8 new procedures by tag", () => {
    expect(ProjectsRpc.requests.get("projects.get")).toBe(ProjectsGetRpc);
    expect(ProjectsRpc.requests.get("projects.discovery")).toBe(
      ProjectsDiscoveryRpc,
    );
    expect(ProjectsRpc.requests.get("projects.updateAutomationSettings")).toBe(
      ProjectsUpdateAutomationSettingsRpc,
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
