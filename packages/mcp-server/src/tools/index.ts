import type {
  ToolContext,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from "./types.js";
import { contextTools } from "./context.js";
import { prTools } from "./pr.js";
import { statusTools } from "./status.js";
import { taskTools } from "./task.js";

export type { ToolDefinition, ToolRegistry, ToolContext, ToolResult };
export { createToolResult, jsonResult, errorResult } from "./types.js";

export function createToolRegistry(): ToolRegistry {
  const registry: ToolRegistry = new Map();

  const allTools: ToolDefinition[] = [
    ...statusTools,
    ...contextTools,
    ...taskTools,
    ...prTools,
  ];

  for (const tool of allTools) {
    registry.set(tool.tool.name, tool);
  }

  return registry;
}

export function getToolsList(registry: ToolRegistry) {
  return Array.from(registry.values()).map((def) => def.tool);
}

export async function callTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const toolDef = registry.get(name);

  if (!toolDef) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await toolDef.handler(args, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error in ${name}: ${message}` }],
      isError: true,
    };
  }
}
