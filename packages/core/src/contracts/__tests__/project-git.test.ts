// Phase 7B-4B Task 8 — Verify ProjectsRpc includes 6 gitProvider + 7
// git RPCs, bringing the total to 56 procedures.

import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import {
  ProjectsRpc,
  // Git provider RPCs
  ProjectsGitProviderListConnectionsRpc,
  ProjectsGitProviderConnectPatRpc,
  ProjectsGitProviderDisconnectRpc,
  ProjectsGitProviderTestConnectionRpc,
  ProjectsGitProviderSetDefaultForRepoRpc,
  ProjectsGitProviderDetectRemoteRpc,
  // Git RPCs
  ProjectsGitPushAndCreatePrRpc,
  ProjectsGitJjIsRepoRpc,
  ProjectsGitJjLogRpc,
  ProjectsGitJjNewRpc,
  ProjectsGitJjDescribeRpc,
  ProjectsGitJjSquashRpc,
  ProjectsGitJjDiffRpc,
} from "../groups/projects.js";

import {
  stubProjectsHandlers,
  STUB_GIT_PROVIDER_CONNECTION_1,
  STUB_JJ_COMMIT_1,
  STUB_REPOSITORY_1,
} from "../stubs/projects.js";

describe("ProjectsRpc group — gitProvider + git (7B-4B Task 8)", () => {
  it("has 56 procedures total (43 existing + 6 gitProvider + 7 git)", () => {
    const tags = Array.from(ProjectsRpc.requests.keys());
    expect(tags.length).toBe(58);
  });

  it("includes the 6 gitProvider procedures by tag", () => {
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.listConnections"),
    ).toBe(ProjectsGitProviderListConnectionsRpc);
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.connectPat"),
    ).toBe(ProjectsGitProviderConnectPatRpc);
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.disconnect"),
    ).toBe(ProjectsGitProviderDisconnectRpc);
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.testConnection"),
    ).toBe(ProjectsGitProviderTestConnectionRpc);
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.setDefaultForRepo"),
    ).toBe(ProjectsGitProviderSetDefaultForRepoRpc);
    expect(
      ProjectsRpc.requests.get("projects.gitProvider.detectRemote"),
    ).toBe(ProjectsGitProviderDetectRemoteRpc);
  });

  it("includes the 7 git procedures by tag", () => {
    expect(
      ProjectsRpc.requests.get("projects.git.pushAndCreatePr"),
    ).toBe(ProjectsGitPushAndCreatePrRpc);
    expect(ProjectsRpc.requests.get("projects.git.jjIsRepo")).toBe(
      ProjectsGitJjIsRepoRpc,
    );
    expect(ProjectsRpc.requests.get("projects.git.jjLog")).toBe(
      ProjectsGitJjLogRpc,
    );
    expect(ProjectsRpc.requests.get("projects.git.jjNew")).toBe(
      ProjectsGitJjNewRpc,
    );
    expect(ProjectsRpc.requests.get("projects.git.jjDescribe")).toBe(
      ProjectsGitJjDescribeRpc,
    );
    expect(ProjectsRpc.requests.get("projects.git.jjSquash")).toBe(
      ProjectsGitJjSquashRpc,
    );
    expect(ProjectsRpc.requests.get("projects.git.jjDiff")).toBe(
      ProjectsGitJjDiffRpc,
    );
  });

  it("preserves the original 43 procedures from prior tasks", () => {
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
    // Task 7 — pull request
    expect(ProjectsRpc.requests.has("projects.pullRequest.list")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.pullRequest.get")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.listByRepository"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.listBySession"),
    ).toBe(true);
    expect(ProjectsRpc.requests.has("projects.pullRequest.create")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.pullRequest.update")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.pullRequest.merge")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.syncCommits"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.linkToPlanningTask"),
    ).toBe(true);
    expect(ProjectsRpc.requests.has("projects.pullRequest.refresh")).toBe(
      true,
    );
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.listReviews"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.pullRequest.addReview"),
    ).toBe(true);
    // Task 7 — feature branch
    expect(ProjectsRpc.requests.has("projects.featureBranch.create")).toBe(
      true,
    );
    expect(ProjectsRpc.requests.has("projects.featureBranch.get")).toBe(true);
    expect(ProjectsRpc.requests.has("projects.featureBranch.list")).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.featureBranch.addTaskPR"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.featureBranch.markTaskPRMerged"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.featureBranch.createFeaturePR"),
    ).toBe(true);
    expect(
      ProjectsRpc.requests.has("projects.featureBranch.updateStatus"),
    ).toBe(true);
  });
});

describe("stubProjectsHandlers — gitProvider (7B-4B Task 8)", () => {
  it("gitProvider.listConnections returns the stub connection", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.listConnections"](),
    );
    expect(result).toEqual([STUB_GIT_PROVIDER_CONNECTION_1]);
  });

  it("gitProvider.connectPat returns a new connection", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.connectPat"]({
        provider: "gitlab",
        accessToken: "glpat-test-token",
        instanceUrl: "https://gitlab.example.com",
      }),
    );
    expect(result.provider).toBe("gitlab");
    expect(result.instanceUrl).toBe("https://gitlab.example.com");
  });

  it("gitProvider.disconnect succeeds for known connection", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.disconnect"]({
        connectionId: STUB_GIT_PROVIDER_CONNECTION_1.id,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("gitProvider.disconnect fails for unknown connection", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.gitProvider.disconnect"]({
        connectionId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("gitProvider.testConnection returns valid result", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.testConnection"]({}),
    );
    expect(result.valid).toBe(true);
    expect(result.user?.username).toBe("acme-dev");
  });

  it("gitProvider.setDefaultForRepo succeeds for known IDs", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.setDefaultForRepo"]({
        repositoryId: STUB_REPOSITORY_1.id,
        connectionId: STUB_GIT_PROVIDER_CONNECTION_1.id,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("gitProvider.detectRemote returns detection for known repo", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.gitProvider.detectRemote"]({
        repositoryId: STUB_REPOSITORY_1.id,
      }),
    );
    expect(result.detected).toBe(true);
    expect(result.provider).toBe("github");
  });

  it("gitProvider.detectRemote fails for unknown repo", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.gitProvider.detectRemote"]({
        repositoryId: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });
});

describe("stubProjectsHandlers — git (7B-4B Task 8)", () => {
  it("git.pushAndCreatePr returns pushed + PR for known repo", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.pushAndCreatePr"]({
        repositoryId: STUB_REPOSITORY_1.id,
        path: "/home/mackieg/repos/acme-repo",
        title: "feat: new feature",
        headBranch: "feat/new",
      }),
    );
    expect(result.pushed).toBe(true);
    expect(result.pullRequest.title).toBe("feat: new feature");
    expect(result.pullRequest.headBranch).toBe("feat/new");
  });

  it("git.pushAndCreatePr fails for unknown repo", async () => {
    const exit = await Effect.runPromiseExit(
      stubProjectsHandlers["projects.git.pushAndCreatePr"]({
        repositoryId: "00000000-0000-0000-0000-000000000000",
        path: "/tmp/unknown",
        title: "test",
        headBranch: "feat/test",
      }),
    );
    expect(exit._tag).toBe("Failure");
  });

  it("git.jjIsRepo returns true", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjIsRepo"]({ path: "/tmp/repo" }),
    );
    expect(result).toBe(true);
  });

  it("git.jjLog returns commit list", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjLog"]({ path: "/tmp/repo" }),
    );
    expect(result).toEqual([STUB_JJ_COMMIT_1]);
  });

  it("git.jjNew returns success", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjNew"]({
        path: "/tmp/repo",
        description: "new commit",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("git.jjDescribe returns success", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjDescribe"]({
        path: "/tmp/repo",
        description: "updated description",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("git.jjSquash returns success", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjSquash"]({ path: "/tmp/repo" }),
    );
    expect(result.success).toBe(true);
  });

  it("git.jjDiff returns diff string", async () => {
    const result = await Effect.runPromise(
      stubProjectsHandlers["projects.git.jjDiff"]({ path: "/tmp/repo" }),
    );
    expect(result.diff).toContain("diff --git");
  });
});
