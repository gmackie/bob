import { beforeEach, describe, expect, it, vi } from "vitest";

import { mirrorT3RuntimeEvent } from "./runtimeEventMirror";

const setIssueStatusMock = vi.hoisted(() => vi.fn());
const dispatchCheckProgressMock = vi.hoisted(() => vi.fn());

vi.mock("../integrations/planningWriteService.js", () => ({
  setIssueStatus: setIssueStatusMock,
}));

vi.mock("../../handlers/dispatch.js", () => ({
  dispatchCheckProgress: dispatchCheckProgressMock,
}));

function createMockDb() {
  const insertValues = vi.fn(() => ({ returning: vi.fn() }));
  const updateWhere = vi.fn(() => ({ returning: vi.fn() }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));

  return {
    query: {
      chatConversations: {
        findFirst: vi.fn(),
      },
      taskRuns: {
        findFirst: vi.fn(),
      },
      dispatchItems: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
    __mock: {
      insertValues,
      updateSet,
      updateWhere,
    },
  };
}

describe("mirrorT3RuntimeEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors t3 progress into Bob session events and task run state", async () => {
    const db = createMockDb();
    db.query.chatConversations.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      nextSeq: 7,
    });
    db.query.taskRuns.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    db.query.dispatchItems.findFirst.mockResolvedValueOnce(null);

    await mirrorT3RuntimeEvent(
      { db, userId: "user-1" },
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        threadId: "bob-session-11111111-1111-4111-8111-111111111111",
        status: "working",
        message: "Running tests",
        details: { phase: "verify" },
      },
    );

    expect(db.__mock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "11111111-1111-4111-8111-111111111111",
        seq: 7,
        direction: "system",
        eventType: "state",
        payload: expect.objectContaining({
          type: "t3_runtime_event",
          status: "working",
          message: "Running tests",
          threadId: "bob-session-11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        workflowStatus: "working",
        statusMessage: "Running tests",
      }),
    );
    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
      }),
    );
  });

  it("marks completed t3 events as completed in Bob", async () => {
    const db = createMockDb();
    db.query.chatConversations.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      nextSeq: 3,
    });
    db.query.taskRuns.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    db.query.dispatchItems.findFirst.mockResolvedValueOnce(null);

    await mirrorT3RuntimeEvent(
      { db, userId: "user-1" },
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        message: "Implementation complete",
      },
    );

    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "stopped",
        workflowStatus: "completed",
        statusMessage: "Implementation complete",
      }),
    );
    expect(db.__mock.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        completedAt: expect.any(Date),
      }),
    );
  });

  it("writes t3 lifecycle status back to the planning provider", async () => {
    const db = createMockDb();
    db.query.chatConversations.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      nextSeq: 5,
    });
    db.query.taskRuns.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });

    await mirrorT3RuntimeEvent(
      { db, userId: "user-1" },
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "review_ready",
        message: "PR is ready",
      },
    );

    expect(setIssueStatusMock).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      status: "in_review",
    });
  });

  it("resolves the Bob session from taskRunId when t3 only sends external task metadata", async () => {
    const db = createMockDb();
    db.query.taskRuns.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    db.query.chatConversations.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      nextSeq: 11,
    });
    db.query.dispatchItems.findFirst.mockResolvedValueOnce(null);

    await mirrorT3RuntimeEvent(
      { db, userId: "user-1" },
      {
        taskRunId: "22222222-2222-4222-8222-222222222222",
        threadId: "thread-1",
        status: "completed",
        message: "Completed in t3code",
      },
    );

    expect(db.__mock.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "11111111-1111-4111-8111-111111111111",
        seq: 11,
        payload: expect.objectContaining({
          taskRunId: "22222222-2222-4222-8222-222222222222",
          threadId: "thread-1",
        }),
      }),
    );
    expect(setIssueStatusMock).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      status: "in_review",
    });
  });

  it("runs dispatch progress after t3 completes a dispatch task run", async () => {
    const db = createMockDb();
    db.query.chatConversations.findFirst.mockResolvedValueOnce({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      nextSeq: 12,
    });
    db.query.taskRuns.findFirst.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    db.query.dispatchItems.findFirst.mockResolvedValueOnce({
      id: "dispatch-item-1",
      batchId: "33333333-3333-4333-8333-333333333333",
      status: "running",
    });

    await mirrorT3RuntimeEvent(
      { db, userId: "user-1" },
      {
        sessionId: "11111111-1111-4111-8111-111111111111",
        taskRunId: "22222222-2222-4222-8222-222222222222",
        status: "completed",
        message: "Implementation complete",
      },
    );

    expect(dispatchCheckProgressMock).toHaveBeenCalledWith(
      { db, userId: "user-1" },
      { batchId: "33333333-3333-4333-8333-333333333333" },
    );
  });
});
