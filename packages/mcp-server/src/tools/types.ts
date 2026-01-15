import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolContext {
  callTrpc: <T>(path: string, input?: unknown) => Promise<T>;
  sessionId: string | null;
}

export type ToolResult = CallToolResult;

export interface ToolDefinition {
  tool: Tool;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
}

export type ToolRegistry = Map<string, ToolDefinition>;

export function createToolResult(text: string, isError = false): ToolResult {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

export function jsonResult(data: unknown): ToolResult {
  return createToolResult(JSON.stringify(data, null, 2));
}

export function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return createToolResult(`Error: ${message}`, true);
}
