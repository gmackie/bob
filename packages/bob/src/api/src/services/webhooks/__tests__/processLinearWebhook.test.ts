import { beforeEach, describe, expect, it, vi } from "vitest";

const dbQueryMocks = {
  workItemsFindFirst: vi.fn(),
  projectsFindFirst: vi.fn(),
  workspaceMembersFindFirst: vi.fn(),
};

const dbSelectMock = vi.fn();
const dbSelectFromMock = vi.fn();
const dbSelectWhereMock = vi.fn();
const dbSelectThenMock = vi.fn();

const dbInsertMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbInsertReturningMock = vi.fn();

const dbUpdateMock = vi.fn();
const dbUpdateSetMock = vi.fn();
const dbUpdateWhereMock = vi.fn();

const mockDb = {
  query: {
    workItems: { findFirst: dbQueryMocks.workItemsFindFirst },
    projects: { findFirst: dbQueryMocks.projectsFindFirst },
    workspaceMembers: { findFirst: dbQueryMocks.workspaceMembersFindFirst },
  },
  select: () => {
    dbSelectMock();
    return {
      from: (table: unknown) => {
        dbSelectFromMock(table);
        return {
          where: (cond: unknown) => {
            dbSelectWhereMock(cond);
            return {
              then: (fn: (rows: any[]) => any) => dbSelectThenMock(fn),
            };
          },
        };
      },
    };
  },
  insert: (table: unknown) => {
    dbInsertMock(table);
    return {
      values: (values: unknown) => {
        dbInsertValuesMock(values);
        return {
          returning: () => dbInsertReturningMock(),
        };
      },
    };
  },
  update: (table: unknown) => {
    dbUpdateMock(table);
    return {
      set: (values: unknown) => {
        dbUpdateSetMock(values);
        return {
          where: (cond: unknown) => {
            dbUpdateWhereMock(cond);
            return Promise.resolve();
          },
        };
      },
    };
  },
};

vi.mock("@bob/db/client", () => ({ db: mockDb }));

const mockMarkDeliveryProcessed = vi.fn();
const mockMarkDeliveryFailed = vi.fn();

vi.mock("../processWebhook", () => ({
  markDeliveryProcessed: (...args: any[]) => mockMarkDeliveryProcessed(...args),
  markDeliveryFailed: (...args: any[]) => mockMarkDeliveryFailed(...args),
}));

const mockExecuteTask = vi.fn();
vi.mock("@bob/execution/runtime/taskExecutor", () => ({
  executeTask: (...args: any[]) => mockExecuteTask(...args),
}));

const { processLinearWebhook } = await import("../processLinearWebhook");

function makeIssuePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "create",
    type: "Issue",
    createdAt: "2026-05-03T00:00:00Z",
    data: {
      id: "linear-issue-1",
      identifier: "BOB-42",
      title: "Implement feature X",
      description: "Build the thing",
      priority: 2,
      state: { id: "state-1", name: "Todo", type: "unstarted" },
      team: { id: "team-linear-1", key: "BOB" },
      project: { id: "linear-proj-1", name: "Bob Project" },
      assignee: null,
      labels: [],
      creatorId: "user-ext-1",
    },
    url: "https://linear.app/team/BOB-42",
    ...overrides,
  };
}

describe("processLinearWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks non-Issue events as processed without handling", async () => {
    const payload = { action: "create", type: "Comment", data: {} };
    await processLinearWebhook("Comment", payload, "delivery-1");

    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-1");
    expect(dbQueryMocks.workItemsFindFirst).not.toHaveBeenCalled();
  });

  it("skips bob-originated issues (bob-managed label)", async () => {
    const payload = makeIssuePayload();
    (payload.data as any).labels = [{ id: "lbl-1", name: "bob-managed" }];

    dbSelectThenMock.mockImplementation((fn: Function) =>
      fn([{ webhookSigningSecret: null, linearTeamId: "team-linear-1" }]),
    );

    await processLinearWebhook("Issue", payload, "delivery-2");

    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-2");
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("skips when no matching project found", async () => {
    const payload = makeIssuePayload();

    dbSelectThenMock.mockImplementation((fn: Function) => fn([]));

    await processLinearWebhook("Issue", payload, "delivery-3");

    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-3");
    expect(mockExecuteTask).not.toHaveBeenCalled();
  });

  it("updates existing work item on issue.update with status change", async () => {
    const payload = makeIssuePayload({
      action: "update",
      updatedFrom: { stateId: "old-state" },
    });
    (payload.data as any).state = { id: "state-2", name: "In Progress", type: "started" };

    dbQueryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: "work-item-1",
      externalId: "linear-issue-1",
      externalProvider: "linear",
    });

    await processLinearWebhook("Issue", payload, "delivery-4");

    expect(dbUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" }),
    );
    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-4");
  });

  it("cancels work item on issue.remove", async () => {
    const payload = makeIssuePayload({ action: "remove" });

    dbQueryMocks.workItemsFindFirst.mockResolvedValueOnce({
      id: "work-item-1",
      externalId: "linear-issue-1",
      externalProvider: "linear",
    });

    await processLinearWebhook("Issue", payload, "delivery-5");

    expect(dbUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-5");
  });

  it("ignores issue.update when no matching work item exists", async () => {
    const payload = makeIssuePayload({
      action: "update",
      updatedFrom: { stateId: "old-state" },
    });

    dbQueryMocks.workItemsFindFirst.mockResolvedValueOnce(null);

    await processLinearWebhook("Issue", payload, "delivery-6");

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(mockMarkDeliveryProcessed).toHaveBeenCalledWith("delivery-6");
  });

  it("marks delivery failed on processing error", async () => {
    const payload = makeIssuePayload({ action: "update" });
    (payload as any).updatedFrom = { stateId: "old-state" };

    dbQueryMocks.workItemsFindFirst.mockRejectedValueOnce(
      new Error("DB connection failed"),
    );

    await expect(
      processLinearWebhook("Issue", payload as any, "delivery-7"),
    ).rejects.toThrow("DB connection failed");

    expect(mockMarkDeliveryFailed).toHaveBeenCalledWith(
      "delivery-7",
      "DB connection failed",
    );
  });
});
