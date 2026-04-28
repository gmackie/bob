import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { taskRunsFindFirstMock, userFindFirstMock } = vi.hoisted(() => ({
  taskRunsFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
}));

vi.mock("@bob/db/client", () => ({
  db: {
    query: {
      taskRuns: {
        findFirst: taskRunsFindFirstMock,
      },
      user: {
        findFirst: userFindFirstMock,
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve()),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

vi.mock("@bob/db", () => ({
  desc: (value: unknown) => value,
  eq: (field: unknown, value: unknown) => ({ field, value }),
  or: (...clauses: unknown[]) => clauses,
}));

vi.mock("@bob/db/schema", () => ({
  chatConversations: { id: { name: "id" } },
  taskRunStatusEnum: ["starting", "running", "blocked", "failed", "completed"],
  taskRuns: {
    workItemId: { name: "work_item_id" },
    planningItemId: { name: "planning_item_id" },
    createdAt: { name: "created_at" },
  },
  user: {
    id: { name: "id" },
    email: { name: "email" },
  },
}));

vi.mock("./taskExecutor.js", () => ({
  executeTask: vi.fn(),
  markTaskBlocked: vi.fn(),
  resumeBlockedTask: vi.fn(),
}));

import { getIssueSessionSnapshot } from "./planningControl";

describe("planning control runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes the latest task run into a planning snapshot", async () => {
    taskRunsFindFirstMock.mockResolvedValueOnce({
      id: "run-1",
      workItemId: "task-1",
      planningItemId: "task-1",
      workItemIdentifierSnapshot: "BUILD-42",
      planningItemIdentifier: "BUILD-42",
      sessionId: "session-1",
      status: "running",
      blockedReason: null,
      branch: "bob/BUILD-42/task",
      repository: {
        id: "repo-1",
        name: "builder",
        path: "/repos/builder",
        mainBranch: "main",
      },
      worktree: null,
      session: {
        workflowStatus: "working",
        status: "running",
        statusMessage: "Applying changes",
        workingDirectory: "/repos/builder",
      },
    });

    const snapshot = await getIssueSessionSnapshot({
      workspaceId: "workspace-1",
      projectId: "project-1",
      issueId: "task-1",
      issueIdentifier: "BUILD-42",
    });

    expect(snapshot).toEqual({
      issueId: "task-1",
      issueIdentifier: "BUILD-42",
      executionBackend: "bob",
      taskRunId: "run-1",
      sessionId: "session-1",
      sessionUrl: "http://localhost:3000/chat?session=session-1",
      workflowStatus: "working",
      sessionStatus: "running",
      runStatus: "running",
      latestSummary: "Applying changes",
      repository: {
        id: "repo-1",
        name: "builder",
        path: "/repos/builder",
        mainBranch: "main",
      },
      worktree: {
        id: null,
        path: "/repos/builder",
        branch: "bob/BUILD-42/task",
      },
    });
  });

  it("uses planning-named control actor types and stop reasons", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./planningControl.ts"),
      "utf8",
    );

    expect(source).not.toContain("KanbangerControlActor");
    expect(source).not.toContain("Stopped from Kanbanger and moved to blocked");
    expect(source).toContain("PlanningControlActor");
    expect(source).toContain("Stopped from planning and moved to blocked");
  });
});
