import type { ToolDefinition } from "./types.js";
import { createToolResult, errorResult, jsonResult } from "./types.js";

function requirePlanningContext(ctx: {
  sessionId: string | null;
  workspaceId: string | null;
  projectId: string | null;
}): { sessionId: string; workspaceId: string; projectId: string } | string {
  if (!ctx.sessionId) return "BOB_SESSION_ID not set";
  if (!ctx.workspaceId) return "BOB_WORKSPACE_ID not set";
  if (!ctx.projectId) return "BOB_PROJECT_ID not set";
  return {
    sessionId: ctx.sessionId,
    workspaceId: ctx.workspaceId,
    projectId: ctx.projectId,
  };
}

export const createDraftTaskTool: ToolDefinition = {
  tool: {
    name: "create_draft_task",
    description:
      "Create a new draft task for the current planning session. " +
      "Call this as you identify work items during planning.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Clear, actionable task title",
        },
        description: {
          type: "string",
          description: "Detailed description with acceptance criteria",
        },
        kind: {
          type: "string",
          enum: ["task", "issue", "epic"],
          description: "Work item kind (default: task)",
        },
        priority: {
          type: "string",
          enum: ["no_priority", "urgent", "high", "medium", "low"],
          description: "Priority (default: no_priority)",
        },
      },
      required: ["title", "description"],
    },
  },
  handler: async (args, ctx) => {
    const planning = requirePlanningContext(ctx);
    if (typeof planning === "string") return errorResult(planning);

    const { title, description, kind, priority } = args as {
      title: string;
      description: string;
      kind?: "task" | "issue" | "epic";
      priority?: "no_priority" | "urgent" | "high" | "medium" | "low";
    };

    try {
      const draft = await ctx.callTrpc<{ id: string; title: string }>(
        "planSession.createDraft",
        {
          sessionId: planning.sessionId,
          workspaceId: planning.workspaceId,
          projectId: planning.projectId,
          title,
          description,
          kind: kind ?? "task",
          priority: priority ?? "no_priority",
        },
      );

      return createToolResult(
        `Draft created: ${draft.id} — ${draft.title}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const updateDraftTaskTool: ToolDefinition = {
  tool: {
    name: "update_draft_task",
    description:
      "Update an existing draft task. Use the draft ID returned from create_draft_task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Draft ID" },
        title: { type: "string" },
        description: { type: "string" },
        kind: { type: "string", enum: ["task", "issue", "epic"] },
        priority: {
          type: "string",
          enum: ["no_priority", "urgent", "high", "medium", "low"],
        },
      },
      required: ["id"],
    },
  },
  handler: async (args, ctx) => {
    const { id, title, description, kind, priority } = args as {
      id: string;
      title?: string;
      description?: string;
      kind?: "task" | "issue" | "epic";
      priority?: "no_priority" | "urgent" | "high" | "medium" | "low";
    };

    try {
      const draft = await ctx.callTrpc<{ id: string; title: string }>(
        "planSession.updateDraft",
        { id, title, description, kind, priority },
      );
      return createToolResult(`Draft updated: ${draft.id} — ${draft.title}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const removeDraftTaskTool: ToolDefinition = {
  tool: {
    name: "remove_draft_task",
    description: "Remove a draft task that's no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Draft ID" },
      },
      required: ["id"],
    },
  },
  handler: async (args, ctx) => {
    const { id } = args as { id: string };
    try {
      await ctx.callTrpc("planSession.removeDraft", { id });
      return createToolResult(`Draft removed: ${id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const setDependencyTool: ToolDefinition = {
  tool: {
    name: "set_dependency",
    description:
      "Mark that one draft task depends on another completing first.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: {
          type: "string",
          description: "The task that is blocked",
        },
        dependsOnDraftId: {
          type: "string",
          description: "The task that must complete first",
        },
      },
      required: ["draftId", "dependsOnDraftId"],
    },
  },
  handler: async (args, ctx) => {
    const { draftId, dependsOnDraftId } = args as {
      draftId: string;
      dependsOnDraftId: string;
    };
    try {
      await ctx.callTrpc("planSession.setDependency", {
        draftId,
        dependsOnDraftId,
      });
      return createToolResult(
        `Dependency set: ${draftId} depends on ${dependsOnDraftId}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const removeDependencyTool: ToolDefinition = {
  tool: {
    name: "remove_dependency",
    description: "Remove a dependency between two draft tasks.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string" },
        dependsOnDraftId: { type: "string" },
      },
      required: ["draftId", "dependsOnDraftId"],
    },
  },
  handler: async (args, ctx) => {
    const { draftId, dependsOnDraftId } = args as {
      draftId: string;
      dependsOnDraftId: string;
    };
    try {
      await ctx.callTrpc("planSession.removeDependency", {
        draftId,
        dependsOnDraftId,
      });
      return createToolResult("Dependency removed");
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const listDraftsTool: ToolDefinition = {
  tool: {
    name: "list_drafts",
    description: "List all current draft tasks for this planning session.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    const planning = requirePlanningContext(ctx);
    if (typeof planning === "string") return errorResult(planning);

    try {
      const result = await ctx.callTrpc<{
        drafts: Array<{
          id: string;
          title: string;
          kind: string;
          priority: string;
          description: string | null;
        }>;
      } | null>("planSession.get", { sessionId: planning.sessionId });
      return jsonResult(result?.drafts ?? []);
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const planTools: ToolDefinition[] = [
  createDraftTaskTool,
  updateDraftTaskTool,
  removeDraftTaskTool,
  setDependencyTool,
  removeDependencyTool,
  listDraftsTool,
];
