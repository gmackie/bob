import { beforeEach, describe, expect, it, vi } from "vitest";

const findPullRequestMock = vi.fn();

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      pullRequests: {
        findFirst: findPullRequestMock,
      },
      repositories: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

describe("taskAutoCreate early-return reasons", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("describes an existing planning link without legacy product naming", async () => {
    findPullRequestMock.mockResolvedValue({
      id: "pr-1",
      userId: "user-1",
      repositoryId: "repo-1",
      sessionId: null,
      planningTaskId: "task-1",
      headBranch: "feature/test",
      baseBranch: "main",
      title: "Add task summary cleanup",
      body: null,
      status: "open",
      url: "https://github.com/org/repo/pull/1",
      additions: 12,
      deletions: 4,
      changedFiles: 2,
    });

    const { autoCreateTaskFromPR } = await import("../taskAutoCreate");

    const result = await autoCreateTaskFromPR({
      pullRequestId: "pr-1",
      userId: "user-1",
      planningWorkspaceId: "workspace-1",
      planningProjectId: "project-1",
    });

    expect(result.created).toBe(false);
    expect(result.taskId).toBe("task-1");
    expect(result.reason).toBe("PR already linked to a planning task");
    expect(result.reason).not.toContain("Kanbanger");
  });
});
