import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../types.js";
import {
  markBlockedTool,
  requestInputTool,
  submitForReviewTool,
  updateStatusTool,
} from "../status.js";

// Helper to create mock context
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

describe("status tools", () => {
  describe("updateStatusTool", () => {
    it("should have correct tool definition", () => {
      expect(updateStatusTool.tool.name).toBe("update_status");
      expect(updateStatusTool.tool.inputSchema.required).toContain("status");
      expect(updateStatusTool.tool.inputSchema.required).toContain("message");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await updateStatusTool.handler(
        { status: "working", message: "Testing" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty("type", "text");
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should call tRPC with correct parameters for working status", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await updateStatusTool.handler(
        {
          status: "working",
          message: "Implementing feature",
          phase: "implementation",
          progress: "2/5",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "working",
          message: "Implementing feature",
          details: { phase: "implementation", progress: "2/5" },
        },
      );
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "Status updated: working",
      );
    });

    it("should call tRPC with correct parameters for completed status", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await updateStatusTool.handler(
        { status: "completed", message: "Task finished" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "completed",
          message: "Task finished",
          details: { phase: undefined, progress: undefined },
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should handle tRPC errors gracefully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("Network error"));

      const result = await updateStatusTool.handler(
        { status: "working", message: "Test" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Network error",
      );
    });
  });

  describe("requestInputTool", () => {
    it("should have correct tool definition", () => {
      expect(requestInputTool.tool.name).toBe("request_input");
      expect(requestInputTool.tool.inputSchema.required).toContain("question");
      expect(requestInputTool.tool.inputSchema.required).toContain(
        "default_action",
      );
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await requestInputTool.handler(
        { question: "Test?", default_action: "proceed" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should call tRPC with correct parameters", async () => {
      const ctx = createMockContext();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      ctx.mockCallTrpc.mockResolvedValue({ expiresAt });

      const result = await requestInputTool.handler(
        {
          question: "Which approach should I use?",
          options: ["Option A", "Option B"],
          default_action: "use Option A",
          timeout_minutes: 45,
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("session.requestInput", {
        sessionId: "test-session-id",
        question: "Which approach should I use?",
        options: ["Option A", "Option B"],
        defaultAction: "use Option A",
        timeoutMinutes: 45,
      });
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "Question posted to user",
      );
      expect((result.content[0] as { text: string }).text).toContain(
        "Option A",
      );
      expect((result.content[0] as { text: string }).text).toContain(
        "Option B",
      );
    });

    it("should work without options", async () => {
      const ctx = createMockContext();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      ctx.mockCallTrpc.mockResolvedValue({ expiresAt });

      const result = await requestInputTool.handler(
        {
          question: "Should I continue?",
          default_action: "continue anyway",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith("session.requestInput", {
        sessionId: "test-session-id",
        question: "Should I continue?",
        options: undefined,
        defaultAction: "continue anyway",
        timeoutMinutes: undefined,
      });
      expect(result.isError).toBeFalsy();
    });

    it("should handle tRPC errors gracefully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("Session not found"));

      const result = await requestInputTool.handler(
        { question: "Test?", default_action: "proceed" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Session not found",
      );
    });
  });

  describe("markBlockedTool", () => {
    it("should have correct tool definition", () => {
      expect(markBlockedTool.tool.name).toBe("mark_blocked");
      expect(markBlockedTool.tool.inputSchema.required).toContain("reason");
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await markBlockedTool.handler(
        { reason: "Missing API key" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should call tRPC with blocked status", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await markBlockedTool.handler(
        { reason: "API key is missing" },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "blocked",
          message: "API key is missing",
        },
      );
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "Marked as blocked",
      );
    });

    it("should format message with blockers list", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await markBlockedTool.handler(
        {
          reason: "Cannot proceed",
          blockers: ["Missing credentials", "Database unavailable"],
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "blocked",
          message:
            "Cannot proceed\n\nBlockers:\n- Missing credentials\n- Database unavailable",
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should handle tRPC errors gracefully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("Invalid transition"));

      const result = await markBlockedTool.handler(
        { reason: "Some reason" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "Invalid transition",
      );
    });
  });

  describe("submitForReviewTool", () => {
    it("should have correct tool definition", () => {
      expect(submitForReviewTool.tool.name).toBe("submit_for_review");
      expect(submitForReviewTool.tool.inputSchema.required).toContain("pr_url");
      expect(submitForReviewTool.tool.inputSchema.required).toContain(
        "summary",
      );
    });

    it("should return error when sessionId is not set", async () => {
      const ctx = createMockContext(null);
      const result = await submitForReviewTool.handler(
        {
          pr_url: "https://github.com/org/repo/pull/123",
          summary: "Added new feature",
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "BOB_SESSION_ID not set",
      );
    });

    it("should call tRPC with awaiting_review status", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await submitForReviewTool.handler(
        {
          pr_url: "https://github.com/org/repo/pull/123",
          summary: "Implemented user authentication",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "awaiting_review",
          message: "Implemented user authentication",
          details: { prUrl: "https://github.com/org/repo/pull/123" },
        },
      );
      expect(result.isError).toBeFalsy();
      expect((result.content[0] as { text: string }).text).toContain(
        "Submitted for review",
      );
      expect((result.content[0] as { text: string }).text).toContain(
        "github.com/org/repo/pull/123",
      );
    });

    it("should include notes for reviewer in message", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockResolvedValue({});

      const result = await submitForReviewTool.handler(
        {
          pr_url: "https://github.com/org/repo/pull/456",
          summary: "Bug fix for login",
          notes_for_reviewer: "Please pay attention to edge cases",
        },
        ctx,
      );

      expect(ctx.mockCallTrpc).toHaveBeenCalledWith(
        "session.reportWorkflowStatus",
        {
          sessionId: "test-session-id",
          status: "awaiting_review",
          message:
            "Bug fix for login\n\nNotes for reviewer:\nPlease pay attention to edge cases",
          details: { prUrl: "https://github.com/org/repo/pull/456" },
        },
      );
      expect(result.isError).toBeFalsy();
    });

    it("should handle tRPC errors gracefully", async () => {
      const ctx = createMockContext();
      ctx.mockCallTrpc.mockRejectedValue(new Error("PR creation failed"));

      const result = await submitForReviewTool.handler(
        {
          pr_url: "https://github.com/org/repo/pull/789",
          summary: "Test",
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(
        "PR creation failed",
      );
    });
  });
});

describe("tool result helpers", () => {
  it("should create success result with text content", async () => {
    const ctx = createMockContext();
    ctx.mockCallTrpc.mockResolvedValue({});

    const result = await updateStatusTool.handler(
      { status: "working", message: "Test" },
      ctx,
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty("type", "text");
    expect(result.isError).toBeFalsy();
  });

  it("should create error result with isError flag", async () => {
    const ctx = createMockContext(null);

    const result = await updateStatusTool.handler(
      { status: "working", message: "Test" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toHaveProperty("type", "text");
  });
});
