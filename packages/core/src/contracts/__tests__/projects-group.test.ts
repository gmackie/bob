// Tests for the ProjectsRpc contract group + stub handlers.
//
// Two cases:
//   1. `ProjectsRpc` resolves the 56 projects.* procedures by tag.
//   2. Stub handlers: `projects.list` returns the 2 stub projects;
//      `projects.getBySlug` fails with `ProjectNotFoundError` on an
//      unknown slug.
import { describe, it, expect } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";

import { ProjectNotFoundError } from "@gmacko/core/projects/errors";

import { ProjectsRpc } from "../groups/projects.js";
import {
  stubProjectsHandlers,
  STUB_PROJECT_1,
  STUB_PROJECT_2,
  STUB_TENANT_ID,
} from "../stubs/projects.js";

describe("ProjectsRpc group", () => {
  it("resolves the 56 projects.* procedures by tag", () => {
    // `RpcGroup` exposes its constituent Rpcs on `.requests` (a Map keyed
    // by the procedure tag). Pull the tag list out and assert ordering.
    const tags = Array.from(
      (ProjectsRpc as unknown as { requests: Map<string, unknown> }).requests.keys(),
    );
    expect(tags).toEqual([
      "projects.create",
      "projects.list",
      "projects.getBySlug",
      "projects.delete",
      // 7B-4B Task 5 — project core
      "projects.get",
      "projects.discovery",
      "projects.updateAutomationSettings",
      "projects.dismissDir",
      // 7B-4B Task 5 — workspace
      "projects.workspace.list",
      "projects.workspace.create",
      "projects.workspace.rename",
      "projects.workspace.delete",
      // 7B-4B Task 6 — repository
      "projects.repository.list",
      "projects.repository.byId",
      "projects.repository.add",
      "projects.repository.addFromProvider",
      "projects.repository.delete",
      "projects.repository.refreshMainBranch",
      "projects.repository.getWorktrees",
      "projects.repository.createWorktree",
      "projects.repository.getWorktreePlanning",
      "projects.repository.updateWorktreePlanning",
      "projects.repository.deleteWorktree",
      "projects.repository.getWorktreeMergeStatus",
      // 7B-4B Task 7 — pull request
      "projects.pullRequest.list",
      "projects.pullRequest.get",
      "projects.pullRequest.listByRepository",
      "projects.pullRequest.listBySession",
      "projects.pullRequest.create",
      "projects.pullRequest.update",
      "projects.pullRequest.merge",
      "projects.pullRequest.syncCommits",
      "projects.pullRequest.linkToPlanningTask",
      "projects.pullRequest.refresh",
      "projects.pullRequest.listReviews",
      "projects.pullRequest.addReview",
      // 7B-4B Task 7 — feature branch
      "projects.featureBranch.create",
      "projects.featureBranch.get",
      "projects.featureBranch.list",
      "projects.featureBranch.addTaskPR",
      "projects.featureBranch.markTaskPRMerged",
      "projects.featureBranch.createFeaturePR",
      "projects.featureBranch.updateStatus",
      // 7B-4B Task 8 — git provider
      "projects.gitProvider.listConnections",
      "projects.gitProvider.connectPat",
      "projects.gitProvider.disconnect",
      "projects.gitProvider.testConnection",
      "projects.gitProvider.setDefaultForRepo",
      "projects.gitProvider.detectRemote",
      // 7B-4B Task 8 — git
      "projects.git.pushAndCreatePr",
      "projects.git.jjIsRepo",
      "projects.git.jjLog",
      "projects.git.jjNew",
      "projects.git.jjDescribe",
      "projects.git.jjSquash",
      "projects.git.jjDiff",
    ]);
  });
});

describe("stubProjectsHandlers", () => {
  // `.toLayer(handlers)` stores handlers behind internal symbols — instead
  // of reaching through that private shape, we re-export the handler
  // record itself from `stubs/projects.ts` so tests can invoke procedures
  // directly. The production code path still uses
  // `stubProjectsHandlersLayer = ProjectsRpc.toLayer(stubProjectsHandlers)`
  // for server wiring.
  it("list returns the two deterministic stub projects and getBySlug fails for unknown slugs", async () => {
    // Happy path — projects.list returns the fixed pair.
    const listResult = await Effect.runPromise(
      stubProjectsHandlers["projects.list"](),
    );
    expect(listResult).toEqual([STUB_PROJECT_1, STUB_PROJECT_2]);

    // Error path — unknown slug surfaces ProjectNotFoundError in the
    // Effect error channel (NOT a defect).
    const missExit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.getBySlug"]({ slug: "does-not-exist" }),
    );
    expect(Exit.isFailure(missExit)).toBe(true);
    if (Exit.isFailure(missExit)) {
      const errOption = Cause.findErrorOption(missExit.cause);
      expect(Option.isSome(errOption)).toBe(true);
      const err = Option.getOrThrow(errOption);
      expect(err).toBeInstanceOf(ProjectNotFoundError);
      expect((err as ProjectNotFoundError).tenantId).toBe(STUB_TENANT_ID);
      expect((err as ProjectNotFoundError).identifier).toBe("does-not-exist");
    }
  });
});
