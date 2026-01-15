import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import {
  getSessionTool,
  getTaskContextTool,
  getWorkflowStateTool,
  listSessionPrsTool,
} from "../context.js";

function createMockContext(
  sessionId: string | null = "test-session-id",
): ToolContext & { mockCallTrpc: ReturnType<typeof vi.fn> } {
  const mockCallTrpc = vi.fn();
  return {
    sessionId,
    callTrpc: mockCallTrpc,
    mockCallTrpc,
  };
}

describe("context tools", () => {
  describe("getSessionTool", () => {
    it("should have correct tool definition", () => {
      expect(getSessionTool.tool.name).toBe("get_session");
      expect(getSessionTool.tool.inputSchema.required).toEqual([]);
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await getSessionTool.handler({}, ctx);

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should return session info with repository and worktree", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        id: "test-session-id",
        title: "Working on feature X",
        repository: { name: "my-repo", path: "/path/to/repo" },
        worktree: { branch: "feature-x", path: "/path/to/worktree" },
        status: "running",
        agentType: "opencode",
        workingDirectory: "/path/to/worktree",
      });

      const result = await getSessionTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.sessionId).toBe("test-session-id");
      expect(data.title).toBe("Working on feature X");
      expect(data.repository.name).toBe("my-repo");
      expect(data.worktree.branch).toBe("feature-x");
      expect(data.agentType).toBe("opencode");
    });

    it("should handle session without repository/worktree", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        id: "test-session-id",
        title: null,
        repository: null,
        worktree: null,
        status: "running",
        agentType: "opencode",
        workingDirectory: "/tmp/test",
      });

      const result = await getSessionTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.repository).toBeNull();
      expect(data.worktree).toBeNull();
    });

    it("should handle tRPC errors gracefully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("Session not found"));

      const result = await getSessionTool.handler({}, ctx);

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Session not found",
      );
    });
  });

  describe("getTaskContextTool", () => {
    it("should have correct tool definition", () => {
      expect(getTaskContextTool.tool.name).toBe("get_task_context");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await getTaskContextTool.handler({}, ctx);

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should indicate when no task is linked", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({ kanbangerTaskId: null });

      const result = await getTaskContextTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.hasTask).toBe(false);
      expect(data.message).toContain("No Kanbanger task");
    });

    it("should return task details when linked", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({ kanbangerTaskId: "task-123" })
        .mockResolvedValueOnce({
          id: "task-123",
          identifier: "BOB-42",
          title: "Implement feature",
          description: "Detailed description",
          status: "in_progress",
          priority: "high",
          labels: [
            { name: "bug", color: "red" },
            { name: "urgent", color: "yellow" },
          ],
          dueDate: "2026-01-20",
        });

      const result = await getTaskContextTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.hasTask).toBe(true);
      expect(data.task.identifier).toBe("BOB-42");
      expect(data.task.labels).toEqual(["bug", "urgent"]);
    });
  });

  describe("getWorkflowStateTool", () => {
    it("should have correct tool definition", () => {
      expect(getWorkflowStateTool.tool.name).toBe("get_workflow_state");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await getWorkflowStateTool.handler({}, ctx);

      expect(result.isError).toBe(true);
    });

    it("should return workflow state with awaiting input", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        workflowStatus: "awaiting_input",
        statusMessage: "Need clarification",
        awaitingInput: {
          question: "Which approach?",
          options: ["A", "B"],
          defaultAction: "use A",
          expiresAt: "2026-01-13T12:00:00Z",
        },
      });

      const result = await getWorkflowStateTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.workflowStatus).toBe("awaiting_input");
      expect(data.awaitingInput.question).toBe("Which approach?");
    });

    it("should return workflow state without awaiting input", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        workflowStatus: "working",
        statusMessage: "Implementing feature",
        awaitingInput: null,
      });

      const result = await getWorkflowStateTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.workflowStatus).toBe("working");
      expect(data.awaitingInput).toBeNull();
    });
  });

  describe("listSessionPrsTool", () => {
    it("should have correct tool definition", () => {
      expect(listSessionPrsTool.tool.name).toBe("list_session_prs");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await listSessionPrsTool.handler({}, ctx);

      expect(result.isError).toBe(true);
    });

    it("should return list of PRs", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue([
        {
          id: "pr-1",
          number: 123,
          title: "Add feature",
          status: "open",
          url: "https://github.com/org/repo/pull/123",
          createdAt: "2026-01-13T10:00:00Z",
        },
        {
          id: "pr-2",
          number: 124,
          title: "Fix bug",
          status: "merged",
          url: "https://github.com/org/repo/pull/124",
          createdAt: "2026-01-13T11:00:00Z",
        },
      ]);

      const result = await listSessionPrsTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.count).toBe(2);
      expect(data.pullRequests).toHaveLength(2);
      expect(data.pullRequests[0].number).toBe(123);
    });

    it("should handle empty PR list", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue([]);

      const result = await listSessionPrsTool.handler({}, ctx);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse((result.content[0] as { text: string }).text);
      expect(data.count).toBe(0);
      expect(data.pullRequests).toEqual([]);
    });
  });
});
