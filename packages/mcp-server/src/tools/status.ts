import type { ToolContext, ToolDefinition } from "./types.js";
import { createToolResult, errorResult, jsonResult } from "./types.js";

export const updateStatusTool: ToolDefinition = {
  tool: {
    name: "update_status",
    description:
      "Update your workflow status to inform Bob and the user what you are doing. " +
      "Call this when starting work, completing phases, or when your status changes.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["working", "completed"],
          description: "Your current workflow status",
        },
        message: {
          type: "string",
          description:
            "Brief description of what you are doing or have completed",
        },
        phase: {
          type: "string",
          description:
            "Optional: Current phase of work (e.g., 'planning', 'implementation', 'testing')",
        },
        progress: {
          type: "string",
          description: "Optional: Progress indicator (e.g., '3/5 tasks')",
        },
      },
      required: ["status", "message"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot update status");
    }

    const { status, message, phase, progress } = args as {
      status: "working" | "completed";
      message: string;
      phase?: string;
      progress?: string;
    };

    try {
      await ctx.callTrpc("session.reportWorkflowStatus", {
        sessionId: ctx.sessionId,
        status,
        message,
        details: { phase, progress },
      });

      return createToolResult(`Status updated: ${status} - ${message}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const requestInputTool: ToolDefinition = {
  tool: {
    name: "request_input",
    description:
      "Ask the user a question and wait for their response. Use this when you need " +
      "clarification or a decision before proceeding. The system will wait for user " +
      "response with a timeout, after which the default action is taken.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional: List of suggested response options",
        },
        default_action: {
          type: "string",
          description:
            "What action to take if user doesn't respond (will happen after timeout)",
        },
        timeout_minutes: {
          type: "number",
          description:
            "Optional: Minutes to wait before taking default action (default: 30, max: 120)",
        },
      },
      required: ["question", "default_action"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot request input");
    }

    const { question, options, default_action, timeout_minutes } = args as {
      question: string;
      options?: string[];
      default_action: string;
      timeout_minutes?: number;
    };

    try {
      const result = await ctx.callTrpc<{ expiresAt: string }>(
        "session.requestInput",
        {
          sessionId: ctx.sessionId,
          question,
          options,
          defaultAction: default_action,
          timeoutMinutes: timeout_minutes,
        },
      );

      const expiresAt = new Date(result.expiresAt);
      const optionsText = options?.length
        ? `\n\nSuggested options:\n${options.map((o) => `  - ${o}`).join("\n")}`
        : "";

      return createToolResult(
        `Question posted to user: "${question}"${optionsText}\n\n` +
          `Default action "${default_action}" will be taken at ${expiresAt.toISOString()} ` +
          `if no response is received.`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const markBlockedTool: ToolDefinition = {
  tool: {
    name: "mark_blocked",
    description:
      "Mark yourself as blocked and unable to proceed. Use this when you encounter " +
      "an issue that prevents further progress and requires human intervention.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Clear explanation of why you are blocked",
        },
        blockers: {
          type: "array",
          items: { type: "string" },
          description: "Optional: List of specific blocking issues",
        },
      },
      required: ["reason"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot mark as blocked");
    }

    const { reason, blockers } = args as {
      reason: string;
      blockers?: string[];
    };

    try {
      const fullReason = blockers?.length
        ? `${reason}\n\nBlockers:\n${blockers.map((b) => `- ${b}`).join("\n")}`
        : reason;

      await ctx.callTrpc("session.reportWorkflowStatus", {
        sessionId: ctx.sessionId,
        status: "blocked",
        message: fullReason,
      });

      return createToolResult(`Marked as blocked: ${reason}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const submitForReviewTool: ToolDefinition = {
  tool: {
    name: "submit_for_review",
    description:
      "Mark work as complete and submit a PR for human review. " +
      "Use this when you have finished implementation and created a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        pr_url: {
          type: "string",
          description: "URL of the pull request to review",
        },
        summary: {
          type: "string",
          description: "Brief summary of the changes",
        },
        notes_for_reviewer: {
          type: "string",
          description: "Optional: Any notes or context for the reviewer",
        },
      },
      required: ["pr_url", "summary"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot submit for review");
    }

    const { pr_url, summary, notes_for_reviewer } = args as {
      pr_url: string;
      summary: string;
      notes_for_reviewer?: string;
    };

    try {
      const message = notes_for_reviewer
        ? `${summary}\n\nNotes for reviewer:\n${notes_for_reviewer}`
        : summary;

      await ctx.callTrpc("session.reportWorkflowStatus", {
        sessionId: ctx.sessionId,
        status: "awaiting_review",
        message,
        details: { prUrl: pr_url },
      });

      return createToolResult(
        `Submitted for review: ${pr_url}\n\nSummary: ${summary}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const statusTools: ToolDefinition[] = [
  updateStatusTool,
  requestInputTool,
  markBlockedTool,
  submitForReviewTool,
];
