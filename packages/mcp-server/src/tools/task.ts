import type { ToolContext, ToolDefinition } from "./types.js";
import { createToolResult, errorResult, jsonResult } from "./types.js";

export const linkTaskTool: ToolDefinition = {
  tool: {
    name: "link_task",
    description:
      "Link a Kanbanger task to this session. Use this when you start working " +
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
      }>("kanbanger.getTaskByIdentifier", { identifier: task_identifier });

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
      "Post a comment on the linked Kanbanger task. Use this to provide " +
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
        kanbangerTaskId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.kanbangerTaskId) {
        return errorResult(
          "No task linked to this session. Use link_task first.",
        );
      }

      await ctx.callTrpc("kanbanger.addComment", {
        issueId: session.kanbangerTaskId,
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
      "Mark the linked Kanbanger task as complete. Use this when you have " +
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

    const { summary, pr_url, mark_issue_done } = args as {
      summary: string;
      pr_url?: string;
      mark_issue_done?: boolean;
    };

    try {
      const session = await ctx.callTrpc<{
        kanbangerTaskId: string | null;
        taskRunId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.taskRunId) {
        return errorResult("No active task run for this session");
      }

      const artifacts = pr_url
        ? [{ type: "pr" as const, url: pr_url, description: "Pull request" }]
        : undefined;

      await ctx.callTrpc("kanbanger.agentCompleteTask", {
        taskRunId: session.taskRunId,
        summary,
        artifacts,
        markIssueDone: mark_issue_done ?? true,
      });

      await ctx.callTrpc("session.reportWorkflowStatus", {
        sessionId: ctx.sessionId,
        status: "completed",
        message: summary,
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
      "Update the status of the linked Kanbanger task (e.g., move to 'in_review').",
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
        kanbangerTaskId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.kanbangerTaskId) {
        return errorResult("No task linked to this session");
      }

      await ctx.callTrpc("kanbanger.updateTask", {
        id: session.kanbangerTaskId,
        status,
      });

      return createToolResult(`Task status updated to: ${status}`);
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
];
