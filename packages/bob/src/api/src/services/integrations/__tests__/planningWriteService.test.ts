import { beforeEach, describe, expect, it, vi } from "vitest";

const findConversationMock = vi.fn();
const findTaskRunMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const thenMock = vi.fn();

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      chatConversations: {
        findFirst: findConversationMock,
      },
      taskRuns: {
        findFirst: findTaskRunMock,
      },
    },
    select: selectMock,
    from: fromMock,
    where: whereMock,
  },
}));

vi.mock("@bob/db", () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

vi.mock("@bob/db/schema", () => ({
  chatConversations: { id: "id", userId: "userId" },
  taskRuns: { sessionId: "sessionId", userId: "userId", createdAt: "createdAt" },
  projects: { workspaceId: "workspaceId", planningProvider: "planningProvider", linearProjectId: "linearProjectId" },
  workspaceIntegrations: { workspaceId: "workspaceId", provider: "provider", enabled: "enabled" },
}));

const mockProvider = {
  createTask: vi.fn(),
  getTask: vi.fn(),
  getTaskByIdentifier: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  reportMilestone: vi.fn(),
  requestInput: vi.fn(),
  resolveInput: vi.fn(),
  setStatus: vi.fn(),
  attachArtifact: vi.fn(),
  markReviewReady: vi.fn(),
  completeTask: vi.fn(),
  addComment: vi.fn(),
};

vi.mock("../planningProvider.js", () => ({
  resolvePlanningProvider: vi.fn().mockResolvedValue(mockProvider),
}));

describe("planningWriteService (provider delegation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findConversationMock.mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      planningTaskId: "issue-123",
      workItemId: null,
      workItemIdentifierSnapshot: null,
    });
    findTaskRunMock.mockResolvedValue({
      id: "run-123",
      sessionId: "session-123",
      userId: "user-123",
      planningItemId: "issue-123",
      planningItemIdentifier: "ENG-123",
      workItemId: null,
      workItemIdentifierSnapshot: null,
      planningProvider: "linear",
      planningWorkspaceId: "ws-123",
    });

    // Mock the project lookup chain
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({
      then: thenMock,
    });
    thenMock.mockImplementation(
      (
        cb: (
          rows: { planningProvider: string; linearProjectId: string }[],
        ) => unknown,
      ) =>
        Promise.resolve(
          cb([{ planningProvider: "linear", linearProjectId: "lin-proj-1" }]),
        ),
    );
  });

  it("delegates reportMilestone to provider", async () => {
    const { reportMilestone } = await import("../planningWriteService");

    await reportMilestone({
      userId: "user-123",
      sessionId: "session-123",
      kind: "progress",
      message: "Built the auth module",
    });

    expect(mockProvider.reportMilestone).toHaveBeenCalledWith(
      "issue-123",
      "run-123",
      { title: "progress", body: "Built the auth module" },
    );
  });

  it("delegates attachArtifact to provider", async () => {
    const { attachArtifact } = await import("../planningWriteService");

    await attachArtifact({
      userId: "user-123",
      sessionId: "session-123",
      artifactType: "pr",
      artifactRole: "review",
      url: "https://github.com/org/repo/pull/42",
      title: "Pull request #42",
      summary: "Adds auth provider",
    });

    expect(mockProvider.attachArtifact).toHaveBeenCalledWith(
      "issue-123",
      "run-123",
      {
        type: "pr",
        role: "review",
        title: "Pull request #42",
        url: "https://github.com/org/repo/pull/42",
        summary: "Adds auth provider",
      },
    );
  });

  it("delegates completeTaskRun to provider.completeTask", async () => {
    const { completeTaskRun } = await import("../planningWriteService");

    await completeTaskRun({
      userId: "user-123",
      sessionId: "session-123",
      summary: "All done",
      prUrl: "https://github.com/org/repo/pull/42",
    });

    expect(mockProvider.completeTask).toHaveBeenCalledWith(
      "issue-123",
      "run-123",
      { outcome: "success", summary: "All done" },
    );
    expect(mockProvider.attachArtifact).toHaveBeenCalledWith(
      "issue-123",
      "run-123",
      expect.objectContaining({ type: "pr", url: "https://github.com/org/repo/pull/42" }),
    );
  });

  it("delegates setIssueStatus to provider.setStatus", async () => {
    const { setIssueStatus } = await import("../planningWriteService");

    await setIssueStatus({
      userId: "user-123",
      sessionId: "session-123",
      status: "in_progress",
    });

    expect(mockProvider.setStatus).toHaveBeenCalledWith(
      "issue-123",
      "run-123",
      "started",
    );
  });

  it("does nothing when no taskRunId in context", async () => {
    findTaskRunMock.mockResolvedValue(null);
    findConversationMock.mockResolvedValue({
      id: "session-123",
      userId: "user-123",
      planningTaskId: null,
      workItemId: null,
      workItemIdentifierSnapshot: null,
    });

    const { reportMilestone } = await import("../planningWriteService");

    await reportMilestone({
      userId: "user-123",
      sessionId: "session-123",
      kind: "progress",
      message: "No task run",
    });

    expect(mockProvider.reportMilestone).not.toHaveBeenCalled();
  });
});
