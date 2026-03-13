import { describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import {
  completeTaskTool,
  linkTaskArtifactTool,
  linkTaskTool,
  postTaskCommentTool,
  recordTaskProgressTool,
  recordVerificationResultTool,
  setTaskReviewReadyTool,
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
        "planning.getTaskByIdentifier",
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
      ctx.mockCallTrpc.mockResolvedValue({ workItemId: null });

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
        .mockResolvedValueOnce({ workItemId: "task-123" })
        .mockResolvedValueOnce({});

      const result = await postTaskCommentTool.handler(
        { comment: "Progress update: 50% done" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("planning.addComment", {
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
      ctx.mockCallTrpc.mockRejectedValue(
        new Error("No active task run for this session"),
      );

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
      ctx.mockCallTrpc.mockResolvedValueOnce({});

      const result = await completeTaskTool.handler(
        { summary: "Implemented user authentication" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.completeTask",
        {
          sessionId: "test-session-id",
          summary: "Implemented user authentication",
          prUrl: undefined,
          markIssueDone: false,
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should include PR artifact when provided", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValueOnce({});

      const result = await completeTaskTool.handler(
        {
          summary: "Bug fix",
          pr_url: "https://github.com/org/repo/pull/789",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.completeTask",
        {
          sessionId: "test-session-id",
          summary: "Bug fix",
          prUrl: "https://github.com/org/repo/pull/789",
          markIssueDone: false,
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should never mark the linked issue done by default", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValueOnce({});

      await completeTaskTool.handler(
        {
          summary: "Ready for merge",
          mark_issue_done: true,
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("session.completeTask", {
        sessionId: "test-session-id",
        summary: "Ready for merge",
        prUrl: undefined,
        markIssueDone: false,
      });
    });
  });

  describe("reportTaskProgressTool", () => {
    it("should report task progress through the shared session mutation", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await recordTaskProgressTool.handler(
        {
          message: "Implemented API contract",
          phase: "implementation",
          progress: "2/4",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportTaskProgress",
        {
          sessionId: "test-session-id",
          message: "Implemented API contract",
          phase: "implementation",
          progress: "2/4",
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe("linkTaskArtifactTool", () => {
    it("should attach an artifact through the shared session mutation", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await linkTaskArtifactTool.handler(
        {
          artifact_type: "doc",
          artifact_role: "documentation",
          url: "https://example.com/design-doc",
          title: "Design doc",
          summary: "Updated implementation notes",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.linkTaskArtifact",
        {
          sessionId: "test-session-id",
          artifactType: "doc",
          artifactRole: "documentation",
          url: "https://example.com/design-doc",
          title: "Design doc",
          summary: "Updated implementation notes",
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe("setTaskReviewReadyTool", () => {
    it("should mark the linked task run review ready through the shared session mutation", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await setTaskReviewReadyTool.handler(
        {
          pr_url: "https://github.com/org/repo/pull/123",
          summary: "Ready for review",
          notes_for_reviewer: "Check the migration path",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.markTaskReviewReady",
        {
          sessionId: "test-session-id",
          prUrl: "https://github.com/org/repo/pull/123",
          summary: "Ready for review",
          notesForReviewer: "Check the migration path",
        },
      );
      expect(result.isError).toBeFalsy();
    });
  });

  describe("recordVerificationResultTool", () => {
    it("should record verification results through the shared session mutation", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await recordVerificationResultTool.handler(
        {
          result: "passed",
          summary: "Unit and integration tests passed",
          artifact_url: "https://example.com/test-report",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.recordVerificationResult",
        {
          sessionId: "test-session-id",
          result: "passed",
          summary: "Unit and integration tests passed",
          artifactUrl: "https://example.com/test-report",
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
      ctx.mockCallTrpc.mockResolvedValue({ workItemId: null });

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
        .mockResolvedValueOnce({ workItemId: "task-123" })
        .mockResolvedValueOnce({});

      const result = await updateTaskStatusTool.handler(
        { status: "in_review" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("planning.updateTask", {
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
