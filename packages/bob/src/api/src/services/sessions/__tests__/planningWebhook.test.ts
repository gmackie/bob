import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  insertCalls,
  updateCalls,
  chatConversationsTable,
  chatMessagesTable,
  sessionEventsTable,
  taskRunsTable,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  insertCalls: [] as { table: unknown; value: unknown }[],
  updateCalls: [] as {
    table: unknown;
    patch: unknown;
    predicate: unknown;
  }[],
  chatConversationsTable: {
    id: { name: "id" },
    nextSeq: { name: "next_seq" },
  },
  chatMessagesTable: { conversationId: { name: "conversation_id" } },
  sessionEventsTable: { sessionId: { name: "session_id" } },
  taskRunsTable: {
    sessionId: { name: "session_id" },
    status: { name: "status" },
  },
}));

vi.mock("@bob/db/client", () => ({
  db: {
    execute: executeMock,
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (value: unknown) => {
        insertCalls.push({ table, value });
        return [];
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: unknown) => ({
        where: vi.fn(async (predicate: unknown) => {
          updateCalls.push({ table, patch, predicate });
          return [];
        }),
      })),
    })),
  },
}));

vi.mock("@bob/db", () => ({
  and: (...clauses: unknown[]) => ({ type: "and", clauses }),
  eq: (field: unknown, value: unknown) => ({ type: "eq", field, value }),
  isNull: (field: unknown) => ({ type: "isNull", field }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    strings,
    values,
  }),
}));

vi.mock("@bob/db/schema", () => ({
  chatConversations: chatConversationsTable,
  chatMessages: chatMessagesTable,
  gitCommits: {},
  pullRequests: {},
  sessionEvents: sessionEventsTable,
  taskRuns: taskRunsTable,
  webhookDeliveries: {},
}));

import { handlePlanningComment } from "../../webhooks/processWebhook";

describe("Planning webhook routing", () => {
  beforeEach(() => {
    executeMock.mockReset();
    insertCalls.length = 0;
    updateCalls.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "ok",
      })),
    );
  });

  it("ignores untargeted comments", async () => {
    await handlePlanningComment({
      issue: { id: "issue-1", identifier: "ENG-1", status: "in_progress" },
      comment: {
        id: "comment-1",
        body: "This is just a normal comment",
        createdAt: new Date().toISOString(),
        user: {
          id: "user-1",
          name: "Human",
          email: "human@example.com",
        },
      },
      bobRouting: {
        shouldRoute: false,
        reason: "mention",
        issueManaged: true,
        promptCommentId: null,
        taskRunId: "run-1",
        sessionId: "session-1",
      },
    });

    expect(executeMock).not.toHaveBeenCalled();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("accepts the first valid prompt reply and resumes the session", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "session-1",
            user_id: "user-1",
            next_seq: 7,
            workflow_status: "awaiting_input",
            awaiting_input_resolved_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "session-1" }] });

    await handlePlanningComment({
      issue: { id: "issue-1", identifier: "ENG-1", status: "blocked" },
      comment: {
        id: "comment-1",
        parentId: "prompt-1",
        body: "Use option A",
        createdAt: new Date().toISOString(),
        user: {
          id: "user-1",
          name: "Human",
          email: "human@example.com",
        },
      },
      bobRouting: {
        shouldRoute: true,
        reason: "prompt_reply",
        issueManaged: true,
        promptCommentId: "prompt-1",
        taskRunId: "run-1",
        sessionId: "session-1",
      },
    });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]?.table).toBe(chatMessagesTable);
    expect(insertCalls[0]?.value).toMatchObject({
      conversationId: "session-1",
      role: "user",
    });
    expect(insertCalls[1]?.table).toBe(sessionEventsTable);
    expect(insertCalls[1]?.value).toMatchObject({
      sessionId: "session-1",
      eventType: "state",
      payload: expect.objectContaining({
        workflowStatus: "working",
        resolution: expect.objectContaining({
          commentId: "comment-1",
          source: "planning_comment",
        }),
      }),
    });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        table: chatConversationsTable,
        patch: { nextSeq: 8 },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("records late prompt replies without reopening the session", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "session-1",
            user_id: "user-1",
            next_seq: 11,
            workflow_status: "working",
            awaiting_input_resolved_at: new Date(),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await handlePlanningComment({
      issue: { id: "issue-1", identifier: "ENG-1", status: "blocked" },
      comment: {
        id: "comment-2",
        parentId: "prompt-1",
        body: "Actually use option B",
        createdAt: new Date().toISOString(),
        user: {
          id: "user-2",
          name: "Reviewer",
          email: "reviewer@example.com",
        },
      },
      bobRouting: {
        shouldRoute: true,
        reason: "prompt_reply",
        issueManaged: true,
        promptCommentId: "prompt-1",
        taskRunId: "run-1",
        sessionId: "session-1",
      },
    });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.table).toBe(sessionEventsTable);
    expect(insertCalls[0]?.value).toMatchObject({
      sessionId: "session-1",
      eventType: "external_reply",
      payload: expect.objectContaining({
        type: "planning_comment_late",
        commentId: "comment-2",
      }),
    });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        table: chatConversationsTable,
        patch: { nextSeq: 12 },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes explicit Bob mentions back into review runs", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: "session-2",
            user_id: "user-1",
            next_seq: 4,
            workflow_status: "awaiting_review",
            awaiting_input_resolved_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await handlePlanningComment({
      issue: { id: "issue-2", identifier: "ENG-2", status: "in_review" },
      comment: {
        id: "comment-3",
        body: "@Bob please address the auth review note",
        createdAt: new Date().toISOString(),
        user: {
          id: "user-3",
          name: "Reviewer",
          email: "reviewer@example.com",
        },
      },
      bobRouting: {
        shouldRoute: true,
        reason: "mention",
        issueManaged: true,
        promptCommentId: null,
        taskRunId: "run-2",
        sessionId: "session-2",
      },
    });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]?.table).toBe(chatMessagesTable);
    expect(insertCalls[1]?.table).toBe(sessionEventsTable);
    expect(insertCalls[1]?.value).toMatchObject({
      sessionId: "session-2",
      eventType: "state",
      payload: expect.objectContaining({
        workflowStatus: "working",
        source: "planning_comment",
        commentId: "comment-3",
      }),
    });
    expect(updateCalls).toContainEqual(
      expect.objectContaining({
        table: chatConversationsTable,
        patch: { nextSeq: 5 },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
