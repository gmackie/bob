import type { ToolContext, ToolDefinition } from "./types.js";
import { errorResult, jsonResult } from "./types.js";

type WorkItemProject = {
  id: string;
  key: string;
  name: string;
};

type WorkItemRecord = {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  kind: string;
  status: string;
  priority?: string;
  projectId?: string | null;
  workspaceId?: string | null;
  project?: WorkItemProject | null;
  updatedAt?: string;
};

type GetWorkItemResult = {
  workItem: WorkItemRecord;
  currentArtifacts: Array<{
    id: string;
    artifactType: string;
    artifactRole: string;
    title?: string | null;
    summary?: string | null;
    url?: string | null;
    createdAt?: string;
  }>;
  childCount: number;
} | null;

type CommentRecord = {
  id: string;
  workItemId: string;
  parentId?: string | null;
  body: string;
  createdAt?: string;
  updatedAt?: string;
};

type ActivityRecord = {
  id: string;
  workItemId: string;
  type: string;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

function getDefaultWorkspaceId() {
  const workspaceId = process.env.BOB_WORKSPACE_ID?.trim();
  return workspaceId ? workspaceId : null;
}

function getDefaultProjectId() {
  const projectId = process.env.BOB_PROJECT_ID?.trim();
  return projectId ? projectId : null;
}

function resolveWorkspaceId(argsWorkspaceId: unknown) {
  if (typeof argsWorkspaceId === "string" && argsWorkspaceId.trim()) {
    return argsWorkspaceId.trim();
  }

  return getDefaultWorkspaceId();
}

function resolveProjectId(argsProjectId: unknown) {
  if (typeof argsProjectId === "string" && argsProjectId.trim()) {
    return argsProjectId.trim();
  }

  return getDefaultProjectId();
}

async function resolveWorkItemReference(ctx: ToolContext, idOrIdentifier: string) {
  const result = await ctx.callTrpc<GetWorkItemResult>("workItems.get", {
    id: idOrIdentifier,
  });

  if (!result?.workItem) {
    throw new Error(`Work item not found: ${idOrIdentifier}`);
  }

  return result;
}

export const listWorkItemsTool: ToolDefinition = {
  tool: {
    name: "list_work_items",
    description:
      "List Bob work items. Provide workspace_id explicitly, or set BOB_WORKSPACE_ID " +
      "in the MCP server environment so agents can list items without repeating it.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: {
          type: "string",
          description:
            "Bob workspace UUID. Optional when BOB_WORKSPACE_ID is configured.",
        },
        project_id: {
          type: "string",
          description:
            "Optional Bob project UUID. Defaults to BOB_PROJECT_ID when configured.",
        },
        parent_id: {
          type: ["string", "null"],
          description:
            "Optional parent work item UUID. Use null to list top-level items only.",
        },
        kind: {
          type: "string",
          enum: ["issue", "epic", "task"],
          description: "Optional work item kind filter.",
        },
        status: {
          type: "string",
          description: "Optional status filter such as todo or in_progress.",
        },
        limit: {
          type: "number",
          description: "Optional result limit between 1 and 100.",
        },
      },
      required: [],
    },
  },
  handler: async (args, ctx) => {
    const workspaceId = resolveWorkspaceId(args.workspace_id);

    if (!workspaceId) {
      return errorResult(
        "workspace_id is required unless BOB_WORKSPACE_ID is configured",
      );
    }

    try {
      const items = await ctx.callTrpc<WorkItemRecord[]>("workItems.list", {
        workspaceId,
        projectId: resolveProjectId(args.project_id) ?? undefined,
        parentId:
          args.parent_id === null
            ? null
            : typeof args.parent_id === "string" && args.parent_id.trim()
              ? args.parent_id.trim()
              : undefined,
        kind: typeof args.kind === "string" ? args.kind : undefined,
        status: typeof args.status === "string" ? args.status : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });

      return jsonResult({
        workspaceId,
        projectId: resolveProjectId(args.project_id),
        count: items.length,
        items,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const getWorkItemTool: ToolDefinition = {
  tool: {
    name: "get_work_item",
    description:
      "Get a Bob work item by UUID or human identifier such as BOB-42.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
      },
      required: ["id_or_identifier"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier } = args as { id_or_identifier: string };

    try {
      const result = await resolveWorkItemReference(ctx, id_or_identifier);
      return jsonResult(result);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const updateWorkItemTool: ToolDefinition = {
  tool: {
    name: "update_work_item",
    description:
      "Update a Bob work item by UUID or identifier. Supports title, description, and status changes.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
        title: {
          type: "string",
          description: "Optional new title.",
        },
        description: {
          type: ["string", "null"],
          description: "Optional new description. Use null to clear it.",
        },
        status: {
          type: "string",
          description: "Optional new status.",
        },
      },
      required: ["id_or_identifier"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier, title, description, status } = args as {
      id_or_identifier: string;
      title?: string;
      description?: string | null;
      status?: string;
    };

    if (
      title === undefined &&
      description === undefined &&
      status === undefined
    ) {
      return errorResult(
        "At least one of title, description, or status must be provided",
      );
    }

    try {
      const { workItem } = await resolveWorkItemReference(ctx, id_or_identifier);
      const updated = await ctx.callTrpc<WorkItemRecord | null>("workItems.update", {
        id: workItem.id,
        title,
        description,
        status,
      });

      return jsonResult(updated);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const listWorkItemCommentsTool: ToolDefinition = {
  tool: {
    name: "list_work_item_comments",
    description:
      "List comments for a Bob work item by UUID or human identifier.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
      },
      required: ["id_or_identifier"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier } = args as { id_or_identifier: string };

    try {
      const { workItem } = await resolveWorkItemReference(ctx, id_or_identifier);
      const comments = await ctx.callTrpc<CommentRecord[]>("workItems.listComments", {
        workItemId: workItem.id,
      });

      return jsonResult({
        workItem: {
          id: workItem.id,
          identifier: workItem.identifier,
          title: workItem.title,
        },
        count: comments.length,
        comments,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const createWorkItemCommentTool: ToolDefinition = {
  tool: {
    name: "create_work_item_comment",
    description:
      "Create a comment on a Bob work item by UUID or human identifier.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
        body: {
          type: "string",
          description: "Comment body in Markdown or plain text.",
        },
        parent_comment_id: {
          type: "string",
          description: "Optional parent comment UUID for replies.",
        },
      },
      required: ["id_or_identifier", "body"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier, body, parent_comment_id } = args as {
      id_or_identifier: string;
      body: string;
      parent_comment_id?: string;
    };

    try {
      const { workItem } = await resolveWorkItemReference(ctx, id_or_identifier);
      const comment = await ctx.callTrpc<CommentRecord>("workItems.createComment", {
        workItemId: workItem.id,
        body,
        parentId: parent_comment_id,
      });

      return jsonResult(comment);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const listWorkItemActivitiesTool: ToolDefinition = {
  tool: {
    name: "list_work_item_activities",
    description:
      "List recent activity records for a Bob work item by UUID or human identifier.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
        limit: {
          type: "number",
          description: "Optional result limit between 1 and 100.",
        },
      },
      required: ["id_or_identifier"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier, limit } = args as {
      id_or_identifier: string;
      limit?: number;
    };

    try {
      const { workItem } = await resolveWorkItemReference(ctx, id_or_identifier);
      const activities = await ctx.callTrpc<ActivityRecord[]>(
        "workItems.listActivities",
        {
          workItemId: workItem.id,
          limit,
        },
      );

      return jsonResult({
        workItem: {
          id: workItem.id,
          identifier: workItem.identifier,
          title: workItem.title,
        },
        count: activities.length,
        activities,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const promoteWorkItemToTaskTool: ToolDefinition = {
  tool: {
    name: "promote_work_item_to_task",
    description:
      "Promote a Bob work item to kind=task by UUID or human identifier.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_identifier: {
          type: "string",
          description: "Bob work item UUID or short identifier such as BOB-42.",
        },
      },
      required: ["id_or_identifier"],
    },
  },
  handler: async (args, ctx) => {
    const { id_or_identifier } = args as { id_or_identifier: string };

    try {
      const { workItem } = await resolveWorkItemReference(ctx, id_or_identifier);
      const updated = await ctx.callTrpc<WorkItemRecord | null>(
        "workItems.promoteToTask",
        {
          id: workItem.id,
        },
      );

      return jsonResult(updated);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const workItemTools: ToolDefinition[] = [
  listWorkItemsTool,
  getWorkItemTool,
  updateWorkItemTool,
  listWorkItemCommentsTool,
  createWorkItemCommentTool,
  listWorkItemActivitiesTool,
  promoteWorkItemToTaskTool,
];
