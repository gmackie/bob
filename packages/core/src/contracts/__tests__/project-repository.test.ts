// Phase 7B-4B Task 6 — Verify ProjectsRpc includes 12 repository RPCs.
//
// After adding 12 repository procedures the group should have 24 total
// (existing 4 + 8 from Task 5 + 12 new).

import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import {
  ProjectsRpc,
  ProjectsRepositoryListRpc,
  ProjectsRepositoryByIdRpc,
  ProjectsRepositoryAddRpc,
  ProjectsRepositoryAddFromProviderRpc,
  ProjectsRepositoryDeleteRpc,
  ProjectsRepositoryRefreshMainBranchRpc,
  ProjectsRepositoryGetWorktreesRpc,
  ProjectsRepositoryCreateWorktreeRpc,
  ProjectsRepositoryGetWorktreePlanningRpc,
  ProjectsRepositoryUpdateWorktreePlanningRpc,
  ProjectsRepositoryDeleteWorktreeRpc,
  ProjectsRepositoryGetWorktreeMergeStatusRpc,
} from "../groups/projects.js";

import {
  stubProjectsHandlers,
  STUB_REPOSITORY_1,
  STUB_WORKTREE_1,
  STUB_WORKTREE_PLAN_1,
} from "../stubs/projects.js";

describe("ProjectsRpc group — repository (7B-4B Task 6)", () => {
  it("has 24 procedures total (4 existing + 8 Task 5 + 12 Task 6)", () => {
    const tags = Array.from(ProjectsRpc.requests.keys());
    expect(tags.length).toBe(24);
  });

  it("includes the 12 repository procedures by tag", () => {
    expect(ProjectsRpc.requests.get("projects.repository.list")).toBe(
      ProjectsRepositoryListRpc,
    );
    expect(ProjectsRpc.requests.get("projects.repository.byId")).toBe(
      ProjectsRepositoryByIdRpc,
    );
    expect(ProjectsRpc.requests.get("projects.repository.add")).toBe(
      ProjectsRepositoryAddRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.repository.addFromProvider"),
    ).toBe(ProjectsRepositoryAddFromProviderRpc);
    expect(ProjectsRpc.requests.get("projects.repository.delete")).toBe(
      ProjectsRepositoryDeleteRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.repository.refreshMainBranch"),
    ).toBe(ProjectsRepositoryRefreshMainBranchRpc);
    expect(ProjectsRpc.requests.get("projects.repository.getWorktrees")).toBe(
      ProjectsRepositoryGetWorktreesRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.repository.createWorktree"),
    ).toBe(ProjectsRepositoryCreateWorktreeRpc);
    expect(
      ProjectsRpc.requests.get("projects.repository.getWorktreePlanning"),
    ).toBe(ProjectsRepositoryGetWorktreePlanningRpc);
    expect(
      ProjectsRpc.requests.get("projects.repository.updateWorktreePlanning"),
    ).toBe(ProjectsRepositoryUpdateWorktreePlanningRpc);
    expect(
      ProjectsRpc.requests.get("projects.repository.deleteWorktree"),
    ).toBe(ProjectsRepositoryDeleteWorktreeRpc);
    expect(
      ProjectsRpc.requests.get("projects.repository.getWorktreeMergeStatus"),
    ).toBe(ProjectsRepositoryGetWorktreeMergeStatusRpc);
  });

  it("preserves the original 12 procedures from Phase 6F + Task 5", () => {
    // Phase 6F
    expect(ProjectsRpc.requests.has("projects.create")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.list")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.getBySlug")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.delete")).toBe(true);
    // Task 5 — project core
    expect(ProjectsRpc.requests.has("projects.get")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.discovery")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.updateAutomationSettings"),
    ).toBe(true);
    expect(ProjectsRpc.requests.has("projects.dismissDir")).toBe(true);
    // Task 5 — workspace
    expect(ProjectsRpc.requests.has("projects.workspace.list")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.workspace.create")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.workspace.rename")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.workspace.delete")).toBe(true);
  });
});

describe("stubProjectsHandlers — repository (7B-4B Task 6)", () => {
  it("repository.list returns the stub repository", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.repository.list"](),
    );
    expect(result).toEqual([STUB_REPOSITORY_1]);
  });

  it("repository.byId returns the stub repository for a known ID", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.repository.byId"]({
        id: STUB_REPOSITORY_1.id,
      }),
    );
    expect(result).toEqual(STUB_REPOSITORY_1);
  });

  it("repository.byId fails for an unknown ID", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.repository.byId"]({
        id: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("repository.getWorktrees returns the stub worktree", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.repository.getWorktrees"]({
        repositoryId: STUB_REPOSITORY_1.id,
      }),
    );
    expect(result).toEqual([STUB_WORKTREE_1]);
  });

  it("repository.getWorktreePlanning returns the stub plan", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.repository.getWorktreePlanning"]({
        worktreeId: STUB_WORKTREE_1.id,
      }),
    );
    expect(result.exists).toBe(true);
    expect(result.dbRecord).toEqual(STUB_WORKTREE_PLAN_1);
  });

  it("repository.getWorktreeMergeStatus returns not-merged for known worktree", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.repository.getWorktreeMergeStatus"]({
        worktreeId: STUB_WORKTREE_1.id,
      }),
    );
    expect(result.merged).toBe(false);
    expect(result.hasUncommittedChanges).toBe(false);
  });
});
