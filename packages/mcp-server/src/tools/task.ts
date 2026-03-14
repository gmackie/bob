import type { ToolContext, ToolDefinition } from "./types.js";
import { createToolResult, errorResult } from "./types.js";

export const linkTaskTool: ToolDefinition = {
  tool: {
    name: "link_task",
    description:
      "Link a task to this session. Use this when you start working " +
      "on a specific task.",
    inputSchema: {
      type: "object",
      properties: {
        task_identifier: {
          type: "string",
          description: "The task identifier (e.g., 'BOB-123')",
        },
      },
      required: ["task_identifier"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot link task");
    }

    const { task_identifier } = args as { task_identifier: string };

    try {
      const task = await ctx.callTrpc<{
        id: string;
        identifier: string;
        title: string;
      }>("planning.getTaskByIdentifier", { identifier: task_identifier });

      await ctx.callTrpc("session.linkTask", {
        sessionId: ctx.sessionId,
        taskId: task.id,
      });

      return createToolResult(
        `Linked task ${task.identifier}: ${task.title} to this session`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const postTaskCommentTool: ToolDefinition = {
  tool: {
    name: "post_task_comment",
    description:
      "Post a comment on the linked task. Use this to provide " +
      "status updates, ask questions, or share information with the team.",
    inputSchema: {
      type: "object",
      properties: {
        comment: {
          type: "string",
          description: "The comment text (supports Markdown)",
        },
      },
      required: ["comment"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot post comment");
    }

    const { comment } = args as { comment: string };

    try {
      const session = await ctx.callTrpc<{
        workItemId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.workItemId) {
        return errorResult(
          "No task linked to this session. Use link_task first.",
        );
      }

      await ctx.callTrpc("planning.addComment", {
        issueId: session.workItemId,
        body: comment,
      });

      return createToolResult("Comment posted to task");
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const completeTaskTool: ToolDefinition = {
  tool: {
    name: "complete_task",
    description:
      "Mark the linked task as complete. Use this when you have " +
      "finished all work on the task.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of what was accomplished",
        },
        pr_url: {
          type: "string",
          description:
            "Optional: URL of the pull request created for this task",
        },
        mark_issue_done: {
          type: "boolean",
          description: "Whether to mark the issue as done (default: true)",
        },
      },
      required: ["summary"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot complete task");
    }

    const { summary, pr_url } = args as {
      summary: string;
      pr_url?: string;
      mark_issue_done?: boolean;
    };

    try {
      await ctx.callTrpc("session.completeTask", {
        sessionId: ctx.sessionId,
        summary,
        prUrl: pr_url,
        markIssueDone: false,
      });

      return createToolResult(`Task completed: ${summary}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const updateTaskStatusTool: ToolDefinition = {
  tool: {
    name: "update_task_status",
    description:
      "Update the status of the linked task (e.g., move to 'in_review').",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["todo", "in_progress", "in_review", "done"],
          description: "The new status for the task",
        },
      },
      required: ["status"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot update task status");
    }

    const { status } = args as { status: string };

    try {
      const session = await ctx.callTrpc<{
        workItemId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.workItemId) {
        return errorResult("No task linked to this session");
      }

      await ctx.callTrpc("planning.updateTask", {
        id: session.workItemId,
        status,
      });

      return createToolResult(`Task status updated to: ${status}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const recordTaskProgressTool: ToolDefinition = {
  tool: {
    name: "report_task_progress",
    description:
      "Report a milestone progress update for the linked task without posting a full chat transcript.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Short progress summary for the task",
        },
        phase: {
          type: "string",
          description: "Optional implementation phase label",
        },
        progress: {
          type: "string",
          description: "Optional coarse progress indicator such as '2/4'",
        },
      },
      required: ["message"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot report task progress");
    }

    const { message, phase, progress } = args as {
      message: string;
      phase?: string;
      progress?: string;
    };

    try {
      await ctx.callTrpc("session.reportTaskProgress", {
        sessionId: ctx.sessionId,
        message,
        phase,
        progress,
      });

      return createToolResult(`Task progress reported: ${message}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const linkTaskArtifactTool: ToolDefinition = {
  tool: {
    name: "link_task_artifact",
    description:
      "Attach a task artifact such as a PR, verification report, doc, or deliverable.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_type: {
          type: "string",
          enum: [
            "pr",
            "verification",
            "build",
            "test_report",
            "doc",
            "deliverable",
            "other",
          ],
          description: "Artifact category",
        },
        artifact_role: {
          type: "string",
          enum: [
            "primary",
            "review",
            "verification",
            "documentation",
            "deliverable",
            "build",
            "test_report",
            "other",
          ],
          description: "Optional artifact role",
        },
        url: {
          type: "string",
          description: "Artifact URL",
        },
        title: {
          type: "string",
          description: "Optional artifact title",
        },
        summary: {
          type: "string",
          description: "Optional short artifact summary",
        },
      },
      required: ["artifact_type", "url"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot attach task artifact");
    }

    const { artifact_type, artifact_role, url, title, summary } = args as {
      artifact_type:
        | "pr"
        | "verification"
        | "build"
        | "test_report"
        | "doc"
        | "deliverable"
        | "other";
      artifact_role?:
        | "primary"
        | "review"
        | "verification"
        | "documentation"
        | "deliverable"
        | "build"
        | "test_report"
        | "other";
      url: string;
      title?: string;
      summary?: string;
    };

    try {
      await ctx.callTrpc("session.linkTaskArtifact", {
        sessionId: ctx.sessionId,
        artifactType: artifact_type,
        artifactRole: artifact_role,
        url,
        title,
        summary,
      });

      return createToolResult(`Artifact linked: ${title ?? url}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const setTaskReviewReadyTool: ToolDefinition = {
  tool: {
    name: "set_task_review_ready",
    description:
      "Mark the linked task as ready for human review and attach the PR link.",
    inputSchema: {
      type: "object",
      properties: {
        pr_url: {
          type: "string",
          description: "Pull request URL",
        },
        summary: {
          type: "string",
          description: "Short review summary",
        },
        notes_for_reviewer: {
          type: "string",
          description: "Optional notes for the reviewer",
        },
      },
      required: ["pr_url", "summary"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot mark review ready");
    }

    const { pr_url, summary, notes_for_reviewer } = args as {
      pr_url: string;
      summary: string;
      notes_for_reviewer?: string;
    };

    try {
      await ctx.callTrpc("session.markTaskReviewReady", {
        sessionId: ctx.sessionId,
        prUrl: pr_url,
        summary,
        notesForReviewer: notes_for_reviewer,
      });

      return createToolResult(`Task submitted for review: ${pr_url}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const recordVerificationResultTool: ToolDefinition = {
  tool: {
    name: "record_verification_result",
    description:
      "Record the latest verification result and optionally attach the report artifact.",
    inputSchema: {
      type: "object",
      properties: {
        result: {
          type: "string",
          enum: ["passed", "failed"],
          description: "Verification outcome",
        },
        summary: {
          type: "string",
          description: "Verification summary",
        },
        artifact_url: {
          type: "string",
          description: "Optional verification artifact URL",
        },
      },
      required: ["result", "summary"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult(
        "BOB_SESSION_ID not set - cannot record verification result",
      );
    }

    const { result, summary, artifact_url } = args as {
      result: "passed" | "failed";
      summary: string;
      artifact_url?: string;
    };

    try {
      await ctx.callTrpc("session.recordVerificationResult", {
        sessionId: ctx.sessionId,
        result,
        summary,
        artifactUrl: artifact_url,
      });

      return createToolResult(`Verification result recorded: ${result}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const taskTools: ToolDefinition[] = [
  linkTaskTool,
  postTaskCommentTool,
  completeTaskTool,
  updateTaskStatusTool,
  recordTaskProgressTool,
  linkTaskArtifactTool,
  setTaskReviewReadyTool,
  recordVerificationResultTool,
];
