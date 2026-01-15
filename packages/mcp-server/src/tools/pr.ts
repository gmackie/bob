import type { ToolContext, ToolDefinition } from "./types.js";
import { createToolResult, errorResult, jsonResult } from "./types.js";

export const createPrTool: ToolDefinition = {
  tool: {
    name: "create_pr",
    description:
      "Create a new pull request for the current session's repository. " +
      "The PR will be linked to this session automatically.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "PR title (max 256 chars)",
        },
        body: {
          type: "string",
          description: "PR description/body (supports Markdown)",
        },
        head_branch: {
          type: "string",
          description: "Source branch name",
        },
        base_branch: {
          type: "string",
          description: "Target branch (defaults to main/master)",
        },
        draft: {
          type: "boolean",
          description: "Create as draft PR (default: false)",
        },
      },
      required: ["title", "head_branch"],
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.sessionId) {
      return errorResult("BOB_SESSION_ID not set - cannot create PR");
    }

    const { title, body, head_branch, base_branch, draft } = args as {
      title: string;
      body?: string;
      head_branch: string;
      base_branch?: string;
      draft?: boolean;
    };

    try {
      const session = await ctx.callTrpc<{
        repositoryId: string | null;
        kanbangerTaskId: string | null;
      }>("session.get", { id: ctx.sessionId });

      if (!session.repositoryId) {
        return errorResult("No repository linked to this session");
      }

      const pr = await ctx.callTrpc<{
        id: string;
        number: number;
        url: string;
        status: string;
      }>("pullRequest.create", {
        repositoryId: session.repositoryId,
        sessionId: ctx.sessionId,
        title,
        body,
        headBranch: head_branch,
        baseBranch: base_branch,
        draft,
        kanbangerTaskId: session.kanbangerTaskId,
      });

      return jsonResult({
        success: true,
        pullRequest: {
          id: pr.id,
          number: pr.number,
          url: pr.url,
          status: pr.status,
        },
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const updatePrTool: ToolDefinition = {
  tool: {
    name: "update_pr",
    description:
      "Update an existing pull request's title, description, or state.",
    inputSchema: {
      type: "object",
      properties: {
        pr_id: {
          type: "string",
          description: "Pull request ID (UUID)",
        },
        title: {
          type: "string",
          description: "New PR title",
        },
        body: {
          type: "string",
          description: "New PR description",
        },
        state: {
          type: "string",
          enum: ["open", "closed"],
          description: "Change PR state",
        },
      },
      required: ["pr_id"],
    },
  },
  handler: async (args, ctx) => {
    const { pr_id, title, body, state } = args as {
      pr_id: string;
      title?: string;
      body?: string;
      state?: "open" | "closed";
    };

    try {
      const pr = await ctx.callTrpc<{
        id: string;
        number: number;
        title: string;
        status: string;
      }>("pullRequest.update", {
        pullRequestId: pr_id,
        title,
        body,
        state,
      });

      return createToolResult(
        `PR #${pr.number} updated: ${pr.title} (${pr.status})`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const getPrStatusTool: ToolDefinition = {
  tool: {
    name: "get_pr_status",
    description: "Get the current status and details of a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        pr_id: {
          type: "string",
          description: "Pull request ID (UUID)",
        },
      },
      required: ["pr_id"],
    },
  },
  handler: async (args, ctx) => {
    const { pr_id } = args as { pr_id: string };

    try {
      const pr = await ctx.callTrpc<{
        id: string;
        number: number;
        title: string;
        body: string | null;
        status: string;
        url: string;
        headBranch: string;
        baseBranch: string;
        additions: number | null;
        deletions: number | null;
        changedFiles: number | null;
        createdAt: string;
        mergedAt: string | null;
        closedAt: string | null;
      }>("pullRequest.get", { pullRequestId: pr_id });

      return jsonResult({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        status: pr.status,
        url: pr.url,
        branches: {
          head: pr.headBranch,
          base: pr.baseBranch,
        },
        stats: {
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
        },
        dates: {
          created: pr.createdAt,
          merged: pr.mergedAt,
          closed: pr.closedAt,
        },
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const mergePrTool: ToolDefinition = {
  tool: {
    name: "merge_pr",
    description:
      "Merge a pull request. Use this after the PR has been approved and " +
      "all checks pass. Requires appropriate permissions.",
    inputSchema: {
      type: "object",
      properties: {
        pr_id: {
          type: "string",
          description: "Pull request ID (UUID)",
        },
        merge_method: {
          type: "string",
          enum: ["merge", "squash", "rebase"],
          description: "Merge method (default: merge)",
        },
      },
      required: ["pr_id"],
    },
  },
  handler: async (args, ctx) => {
    const { pr_id, merge_method } = args as {
      pr_id: string;
      merge_method?: "merge" | "squash" | "rebase";
    };

    try {
      const result = await ctx.callTrpc<{
        id: string;
        number: number;
        status: string;
        mergedAt: string;
      }>("pullRequest.merge", {
        pullRequestId: pr_id,
        mergeMethod: merge_method,
      });

      return createToolResult(
        `PR #${result.number} merged successfully at ${result.mergedAt}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const refreshPrTool: ToolDefinition = {
  tool: {
    name: "refresh_pr",
    description:
      "Refresh PR data from the remote Git provider to get latest status, " +
      "review comments, and check results.",
    inputSchema: {
      type: "object",
      properties: {
        pr_id: {
          type: "string",
          description: "Pull request ID (UUID)",
        },
      },
      required: ["pr_id"],
    },
  },
  handler: async (args, ctx) => {
    const { pr_id } = args as { pr_id: string };

    try {
      const pr = await ctx.callTrpc<{
        id: string;
        number: number;
        status: string;
      }>("pullRequest.refresh", { pullRequestId: pr_id });

      return createToolResult(
        `PR #${pr.number} refreshed: status is ${pr.status}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const prTools: ToolDefinition[] = [
  createPrTool,
  updatePrTool,
  getPrStatusTool,
  mergePrTool,
  refreshPrTool,
];
