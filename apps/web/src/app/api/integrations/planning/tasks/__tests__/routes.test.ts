import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  startIssueSessionMock,
  resumeIssueSessionMock,
  stopIssueSessionMock,
  getIssueSessionSnapshotMock,
  getPlanningControlConfigMock,
  verifyPlanningControlRequestMock,
} = vi.hoisted(() => ({
  startIssueSessionMock: vi.fn(),
  resumeIssueSessionMock: vi.fn(),
  stopIssueSessionMock: vi.fn(),
  getIssueSessionSnapshotMock: vi.fn(),
  getPlanningControlConfigMock: vi.fn(),
  verifyPlanningControlRequestMock: vi.fn(),
}));

vi.mock("@bob/execution/runtime/planningControl", () => ({
  startIssueSession: startIssueSessionMock,
  resumeIssueSession: resumeIssueSessionMock,
  stopIssueSession: stopIssueSessionMock,
  getIssueSessionSnapshot: getIssueSessionSnapshotMock,
}));

vi.mock("@bob/api/services/integrations/planningControlConfig", () => ({
  getPlanningControlConfig: getPlanningControlConfigMock,
}));

vi.mock("@bob/api/services/integrations/planningControlVerifier", () => ({
  verifyPlanningControlRequest: verifyPlanningControlRequestMock,
}));

import { GET as getSessionRoute } from "../session/route";
import { POST as startRoute } from "../start/route";
import { POST as stopRoute } from "../stop/route";

const snapshot = {
  issueId: "task-123",
  issueIdentifier: "BUILD-123",
  executionBackend: "bob",
  taskRunId: "run-123",
  sessionId: "session-123",
  sessionUrl: "https://bob.example.internal/chat/session-123",
  workflowStatus: "working",
  sessionStatus: "running",
  runStatus: "running",
  latestSummary: "Working through repository changes",
  repository: {
    id: "repo-123",
    name: "example",
    path: "/repos/example",
    mainBranch: "main",
  },
  worktree: {
    id: null,
    path: "/repos/example",
    branch: "bob/BUILD-123/example-task",
  },
};

describe("Planning task control routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlanningControlConfigMock.mockReturnValue({
      baseUrl: "https://planning.example.internal",
      sharedSecret: "super-secret",
      maxSkewMs: 300000,
    });
    verifyPlanningControlRequestMock.mockReturnValue({
      timestamp: "1710000000000",
      idempotencyKey: "idem-123",
    });
  });

  it("accepts a valid signed planning start request", async () => {
    startIssueSessionMock.mockResolvedValue(snapshot);

    const response = await startRoute(
      new Request("https://bob.example.internal/api/integrations/planning/tasks/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Planning-Timestamp": "1710000000000",
          "Idempotency-Key": "idem-123",
          "X-Planning-Signature": "sha256=signed",
        },
        body: JSON.stringify({
          workspaceId: "workspace-123",
          projectId: "project-123",
          issueId: "task-123",
          issueIdentifier: "BUILD-123",
          title: "Example task",
          actor: {
            id: "user-123",
            email: "alice@example.com",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(startIssueSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "task-123",
        issueIdentifier: "BUILD-123",
      }),
    );
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("returns a blocked snapshot for planning stop requests", async () => {
    stopIssueSessionMock.mockResolvedValue({
      ...snapshot,
      workflowStatus: "blocked",
      runStatus: "blocked",
      latestSummary: "Stopped from planning: Waiting on product decision",
    });

    const response = await stopRoute(
      new Request("https://bob.example.internal/api/integrations/planning/tasks/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Planning-Timestamp": "1710000000000",
          "Idempotency-Key": "idem-stop-123",
          "X-Planning-Signature": "sha256=signed",
        },
        body: JSON.stringify({
          workspaceId: "workspace-123",
          projectId: "project-123",
          issueId: "task-123",
          issueIdentifier: "BUILD-123",
          actor: {
            id: "user-123",
          },
          reason: "Waiting on product decision",
        }),
      }),
    );

    const payload = (await response.json()) as {
      workflowStatus: string;
      runStatus: string;
    };

    expect(response.status).toBe(200);
    expect(payload.workflowStatus).toBe("blocked");
    expect(payload.runStatus).toBe("blocked");
  });

  it("returns the normalized linked-session snapshot for planning session queries", async () => {
    getIssueSessionSnapshotMock.mockResolvedValue(snapshot);

    const response = await getSessionRoute(
      new Request(
        "https://bob.example.internal/api/integrations/planning/tasks/session?workspaceId=workspace-123&projectId=project-123&issueId=task-123&issueIdentifier=BUILD-123",
        {
          method: "GET",
          headers: {
            "X-Planning-Timestamp": "1710000000000",
            "Idempotency-Key": "idem-session-123",
            "X-Planning-Signature": "sha256=signed",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(getIssueSessionSnapshotMock).toHaveBeenCalledWith({
      workspaceId: "workspace-123",
      projectId: "project-123",
      issueId: "task-123",
      issueIdentifier: "BUILD-123",
    });
    await expect(response.json()).resolves.toEqual(snapshot);
  });
});
