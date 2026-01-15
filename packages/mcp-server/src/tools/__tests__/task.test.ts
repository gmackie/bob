import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import {
  completeTaskTool,
  linkTaskTool,
  postTaskCommentTool,
  updateTaskStatusTool,
} from "../task.js";

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

describe("task tools", () => {
  describe("linkTaskTool", () => {
    it("should have correct tool definition", () => {
      expect(linkTaskTool.tool.name).toBe("link_task");
      expect(linkTaskTool.tool.inputSchema.required).toContain(
        "task_identifier",
      );
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await linkTaskTool.handler(
        { task_identifier: "BOB-123" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should link task successfully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          id: "task-uuid",
          identifier: "BOB-123",
          title: "Implement login",
        })
        .mockResolvedValueOnce({});

      const result = await linkTaskTool.handler(
        { task_identifier: "BOB-123" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "kanbanger.getTaskByIdentifier",
        { identifier: "BOB-123" },
      );
      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("session.linkTask", {
        sessionId: "test-session-id",
        taskId: "task-uuid",
      });
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain("BOB-123");
      expect((result.content[0] as { text: string }).text).toContain(
        "Implement login",
      );
    });

    it("should handle task not found error", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("Task not found"));

      const result = await linkTaskTool.handler(
        { task_identifier: "BOB-999" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Task not found",
      );
    });
  });

  describe("postTaskCommentTool", () => {
    it("should have correct tool definition", () => {
      expect(postTaskCommentTool.tool.name).toBe("post_task_comment");
      expect(postTaskCommentTool.tool.inputSchema.required).toContain(
        "comment",
      );
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await postTaskCommentTool.handler(
        { comment: "Test comment" },
        ctx,
      );

      expect(result.isError).toBe(true);
    });

    it("should return error when no task is linked", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({ kanbangerTaskId: null });

      const result = await postTaskCommentTool.handler(
        { comment: "Test comment" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "No task linked",
      );
    });

    it("should post comment successfully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({ kanbangerTaskId: "task-123" })
        .mockResolvedValueOnce({});

      const result = await postTaskCommentTool.handler(
        { comment: "Progress update: 50% done" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("kanbanger.addComment", {
        issueId: "task-123",
        body: "Progress update: 50% done",
      });
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "Comment posted",
      );
    });
  });

  describe("completeTaskTool", () => {
    it("should have correct tool definition", () => {
      expect(completeTaskTool.tool.name).toBe("complete_task");
      expect(completeTaskTool.tool.inputSchema.required).toContain("summary");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await completeTaskTool.handler(
        { summary: "Completed work" },
        ctx,
      );

      expect(result.isError).toBe(true);
    });

    it("should return error when no task run exists", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({
        kanbangerTaskId: "task-123",
        taskRunId: null,
      });

      const result = await completeTaskTool.handler(
        { summary: "Completed work" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "No active task run",
      );
    });

    it("should complete task successfully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          kanbangerTaskId: "task-123",
          taskRunId: "run-456",
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await completeTaskTool.handler(
        { summary: "Implemented user authentication" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "kanbanger.agentCompleteTask",
        {
          taskRunId: "run-456",
          summary: "Implemented user authentication",
          artifacts: undefined,
          markIssueDone: true,
        },
      );
      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "completed",
          message: "Implemented user authentication",
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should include PR artifact when provided", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({
          kanbangerTaskId: "task-123",
          taskRunId: "run-456",
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const result = await completeTaskTool.handler(
        {
          summary: "Bug fix",
          pr_url: "https://github.com/org/repo/pull/789",
          mark_issue_done: false,
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "kanbanger.agentCompleteTask",
        {
          taskRunId: "run-456",
          summary: "Bug fix",
          artifacts: [
            {
              type: "pr",
              url: "https://github.com/org/repo/pull/789",
              description: "Pull request",
            },
          ],
          markIssueDone: false,
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe("updateTaskStatusTool", () => {
    it("should have correct tool definition", () => {
      expect(updateTaskStatusTool.tool.name).toBe("update_task_status");
      expect(updateTaskStatusTool.tool.inputSchema.required).toContain(
        "status",
      );
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await updateTaskStatusTool.handler(
        { status: "in_progress" },
        ctx,
      );

      expect(result.isError).toBe(true);
    });

    it("should return error when no task is linked", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({ kanbangerTaskId: null });

      const result = await updateTaskStatusTool.handler(
        { status: "in_review" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "No task linked",
      );
    });

    it("should update task status successfully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc
        .mockResolvedValueOnce({ kanbangerTaskId: "task-123" })
        .mockResolvedValueOnce({});

      const result = await updateTaskStatusTool.handler(
        { status: "in_review" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("kanbanger.updateTask", {
        id: "task-123",
        status: "in_review",
      });
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "in_review",
      );
    });
  });
});
