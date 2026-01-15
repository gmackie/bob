import type { ToolContext, ToolDefinition } from "./types.js";
import { errorResult, jsonResult } from "./types.js";

export const getSessionTool: ToolDefinition = {
  tool: {
    name: "get_session",
    description:
      "Get information about your current session including repository, worktree, " +
      "and task context. Use this to understand what you're working on.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot get session info");
    }

    try {
      const session = await ctx.callTrpc<{
        id: string;
        title: string | null;
        repository: { name: string; path: string } | null;
        worktree: { branch: string; path: string } | null;
        status: string;
        agentType: string;
        workingDirectory: string;
      }>("session.get", { id: ctx.sessionId });

      return jsonResult({
        sessionId: session.id,
        title: session.title,
        status: session.status,
        agentType: session.agentType,
        workingDirectory: session.workingDirectory,
        repository: session.repository
          ? { name: session.repository.name, path: session.repository.path }
          : null,
        worktree: session.worktree
          ? { branch: session.worktree.branch, path: session.worktree.path }
          : null,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const getTaskContextTool: ToolDefinition = {
  tool: {
    name: "get_task_context",
    description:
      "Get details about the Kanbanger task assigned to this session, if any. " +
      "Includes task description, labels, priority, and any related context.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot get task context");
    }

    try {
      const session = await ctx.callTrpc<{
        kanbangerTaskId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.kanbangerTaskId) {
        return jsonResult({
          hasTask: false,
          message: "No Kanbanger task linked to this session",
        });
      }

      const task = await ctx.callTrpc<{
        id: string;
        identifier: string;
        title: string;
        description?: string;
        status: string;
        priority: string;
        labels?: Array<{ name: string; color: string }>;
        dueDate?: string;
      }>("kanbanger.getTask", { id: session.kanbangerTaskId });

      return jsonResult({
        hasTask: true,
        task: {
          id: task.id,
          identifier: task.identifier,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          labels: task.labels?.map((l) => l.name) ?? [],
          dueDate: task.dueDate,
        },
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const getWorkflowStateTool: ToolDefinition = {
  tool: {
    name: "get_workflow_state",
    description:
      "Get your current workflow state including status, any pending questions, " +
      "and resolution history.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot get workflow state");
    }

    try {
      const state = await ctx.callTrpc<{
        workflowStatus: string;
        statusMessage: string | null;
        awaitingInput: {
          question: string;
          options: string[] | null;
          defaultAction: string;
          expiresAt: string;
        } | null;
      }>("session.getWorkflowState", { sessionId: ctx.sessionId });

      return jsonResult(state);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const listSessionPrsTool: ToolDefinition = {
  tool: {
    name: "list_session_prs",
    description: "List all pull requests created in this session.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async (_args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot list PRs");
    }

    try {
      const prs = await ctx.callTrpc<
        Array<{
          id: string;
          number: number;
          title: string;
          status: string;
          url: string;
          createdAt: string;
        }>
      >("pullRequest.listBySession", { sessionId: ctx.sessionId });

      return jsonResult({
        count: prs.length,
        pullRequests: prs,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const contextTools: ToolDefinition[] = [
  getSessionTool,
  getTaskContextTool,
  getWorkflowStateTool,
  listSessionPrsTool,
];
