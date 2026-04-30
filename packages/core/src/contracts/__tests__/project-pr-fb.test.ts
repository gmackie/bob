// Phase 7B-4B Task 7 — Verify ProjectsRpc includes 12 pullRequest + 7
// featureBranch RPCs, bringing the total to 43 procedures.

import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import {
  ProjectsRpc,
  // Pull request RPCs
  ProjectsPullRequestListRpc,
  ProjectsPullRequestGetRpc,
  ProjectsPullRequestListByRepositoryRpc,
  ProjectsPullRequestListBySessionRpc,
  ProjectsPullRequestCreateRpc,
  ProjectsPullRequestUpdateRpc,
  ProjectsPullRequestMergeRpc,
  ProjectsPullRequestSyncCommitsRpc,
  ProjectsPullRequestLinkToPlanningTaskRpc,
  ProjectsPullRequestRefreshRpc,
  ProjectsPullRequestListReviewsRpc,
  ProjectsPullRequestAddReviewRpc,
  // Feature branch RPCs
  ProjectsFeatureBranchCreateRpc,
  ProjectsFeatureBranchGetRpc,
  ProjectsFeatureBranchListRpc,
  ProjectsFeatureBranchAddTaskPRRpc,
  ProjectsFeatureBranchMarkTaskPRMergedRpc,
  ProjectsFeatureBranchCreateFeaturePRRpc,
  ProjectsFeatureBranchUpdateStatusRpc,
} from "../groups/projects.js";

import {
  stubProjectsHandlers,
  STUB_PULL_REQUEST_1,
  STUB_PR_REVIEW_1,
  STUB_FEATURE_BRANCH_1,
  STUB_FEATURE_BRANCH_TASK_PR_1,
} from "../stubs/projects.js";

describe("ProjectsRpc group — pullRequest + featureBranch (7B-4B Task 7)", () => {
  it("has 56 procedures total (24 existing + 12 PR + 7 FB + 13 Task 8)", () => {
    const tags = Array.from(ProjectsRpc.requests.keys());
    expect(tags.length).toBe(56);
  });

  it("includes the 12 pullRequest procedures by tag", () => {
    expect(ProjectsRpc.requests.get("projects.pullRequest.list")).toBe(
      ProjectsPullRequestListRpc,
    );
    expect(ProjectsRpc.requests.get("projects.pullRequest.get")).toBe(
      ProjectsPullRequestGetRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.pullRequest.listByRepository"),
    ).toBe(ProjectsPullRequestListByRepositoryRpc);
    expect(
      ProjectsRpc.requests.get("projects.pullRequest.listBySession"),
    ).toBe(ProjectsPullRequestListBySessionRpc);
    expect(ProjectsRpc.requests.get("projects.pullRequest.create")).toBe(
      ProjectsPullRequestCreateRpc,
    );
    expect(ProjectsRpc.requests.get("projects.pullRequest.update")).toBe(
      ProjectsPullRequestUpdateRpc,
    );
    expect(ProjectsRpc.requests.get("projects.pullRequest.merge")).toBe(
      ProjectsPullRequestMergeRpc,
    );
    expect(ProjectsRpc.requests.get("projects.pullRequest.syncCommits")).toBe(
      ProjectsPullRequestSyncCommitsRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.pullRequest.linkToPlanningTask"),
    ).toBe(ProjectsPullRequestLinkToPlanningTaskRpc);
    expect(ProjectsRpc.requests.get("projects.pullRequest.refresh")).toBe(
      ProjectsPullRequestRefreshRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.pullRequest.listReviews"),
    ).toBe(ProjectsPullRequestListReviewsRpc);
    expect(ProjectsRpc.requests.get("projects.pullRequest.addReview")).toBe(
      ProjectsPullRequestAddReviewRpc,
    );
  });

  it("includes the 7 featureBranch procedures by tag", () => {
    expect(ProjectsRpc.requests.get("projects.featureBranch.create")).toBe(
      ProjectsFeatureBranchCreateRpc,
    );
    expect(ProjectsRpc.requests.get("projects.featureBranch.get")).toBe(
      ProjectsFeatureBranchGetRpc,
    );
    expect(ProjectsRpc.requests.get("projects.featureBranch.list")).toBe(
      ProjectsFeatureBranchListRpc,
    );
    expect(ProjectsRpc.requests.get("projects.featureBranch.addTaskPR")).toBe(
      ProjectsFeatureBranchAddTaskPRRpc,
    );
    expect(
      ProjectsRpc.requests.get("projects.featureBranch.markTaskPRMerged"),
    ).toBe(ProjectsFeatureBranchMarkTaskPRMergedRpc);
    expect(
      ProjectsRpc.requests.get("projects.featureBranch.createFeaturePR"),
    ).toBe(ProjectsFeatureBranchCreateFeaturePRRpc);
    expect(
      ProjectsRpc.requests.get("projects.featureBranch.updateStatus"),
    ).toBe(ProjectsFeatureBranchUpdateStatusRpc);
  });

  it("preserves the original 24 procedures from Phase 6F + Task 5 + Task 6", () => {
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
    // Task 6 — repository
    expect(ProjectsRpc.requests.has("projects.repository.list")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.repository.byId")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.repository.add")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.addFromProvider"),
    ).toBe(true);
    expect(ProjectsRpc.requests.has("projects.repository.delete")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.refreshMainBranch"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.getWorktrees"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.createWorktree"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.getWorktreePlanning"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.updateWorktreePlanning"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.deleteWorktree"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.repository.getWorktreeMergeStatus"),
    ).toBe(true);
  });
});

describe("stubProjectsHandlers — pullRequest (7B-4B Task 7)", () => {
  it("pullRequest.list returns the stub PR", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.list"]({}),
    );
    expect(result).toEqual([STUB_PULL_REQUEST_1]);
  });

  it("pullRequest.get returns stub for known ID", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.get"]({
        pullRequestId: STUB_PULL_REQUEST_1.id,
      }),
    );
    expect(result).toEqual(STUB_PULL_REQUEST_1);
  });

  it("pullRequest.get fails for unknown ID", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.pullRequest.get"]({
        pullRequestId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("pullRequest.create returns a new PR", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.create"]({
        repositoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        title: "test PR",
        headBranch: "feat/test",
      }),
    );
    expect(result.title).toBe("test PR");
    expect(result.headBranch).toBe("feat/test");
    expect(result.status).toBe("open");
  });

  it("pullRequest.merge returns merged status for known ID", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.merge"]({
        pullRequestId: STUB_PULL_REQUEST_1.id,
      }),
    );
    expect(result.status).toBe("merged");
    expect(result.mergedAt).toBeTruthy();
  });

  it("pullRequest.listReviews returns reviews for known PR", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.listReviews"]({
        pullRequestId: STUB_PULL_REQUEST_1.id,
      }),
    );
    expect(result).toEqual([STUB_PR_REVIEW_1]);
  });

  it("pullRequest.addReview returns a new review", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.pullRequest.addReview"]({
        pullRequestId: STUB_PULL_REQUEST_1.id,
        status: "commented",
        body: "Nice work",
      }),
    );
    expect(result.status).toBe("commented");
    expect(result.body).toBe("Nice work");
  });
});

describe("stubProjectsHandlers — featureBranch (7B-4B Task 7)", () => {
  it("featureBranch.create returns a new branch", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.featureBranch.create"]({
        workItemId: "11111111-aaaa-bbbb-cccc-dddddddddddd",
        repositoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        branchName: "feature/test",
      }),
    );
    expect(result.branchName).toBe("feature/test");
    expect(result.status).toBe("active");
  });

  it("featureBranch.get returns detail for known ID", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.featureBranch.get"]({
        id: STUB_FEATURE_BRANCH_1.id,
      }),
    );
    expect(result.id).toBe(STUB_FEATURE_BRANCH_1.id);
    expect(result.taskPRs.length).toBe(1);
  });

  it("featureBranch.get fails for unknown ID", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.featureBranch.get"]({
        id: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("featureBranch.list returns list items with taskPRCount", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.featureBranch.list"]({
        workItemId: STUB_FEATURE_BRANCH_1.workItemId,
      }),
    );
    expect(result.length).toBe(1);
    expect(result[0].taskPRCount).toBe(1);
  });

  it("featureBranch.updateStatus changes status", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.featureBranch.updateStatus"]({
        id: STUB_FEATURE_BRANCH_1.id,
        status: "ready",
      }),
    );
    expect(result.status).toBe("ready");
  });

  it("featureBranch.createFeaturePR returns branch + PR pair", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.featureBranch.createFeaturePR"]({
        featureBranchId: STUB_FEATURE_BRANCH_1.id,
        title: "Feature PR",
        repositoryId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      }),
    );
    expect(result.featureBranch.featurePrId).toBeTruthy();
    expect(result.pullRequest.title).toBe("Feature PR");
  });
});
