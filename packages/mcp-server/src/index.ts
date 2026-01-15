#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ToolContext } from "./tools/index.js";
import { callTool, createToolRegistry, getToolsList } from "./tools/index.js";

const API_URL = process.env.BOB_API_URL ?? "http://localhost:3000";
const API_KEY = process.env.BOB_API_KEY;
const SESSION_ID = process.env.BOB_SESSION_ID ?? null;

if (!API_KEY) {
  console.error("Error: BOB_API_KEY environment variable is required");
  process.exit(1);
}

interface TrpcResponse<T> {
  result?: {
    data: T;
  };
  error?: {
    message: string;
    code: string;
  };
}

async function callTrpc<T>(path: string, input?: unknown): Promise<T> {
  const url = new URL(`/api/trpc/${path}`, API_URL);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      json: input ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as TrpcResponse<T>;

  if (data.error) {
    throw new Error(`tRPC Error (${data.error.code}): ${data.error.message}`);
  }

  if (!data.result) {
    throw new Error("Invalid tRPC response: missing result");
  }

  return data.result.data;
}

const toolRegistry = createToolRegistry();

const toolContext: ToolContext = {
  callTrpc,
  sessionId: SESSION_ID,
};

const server = new Server(
  {
    name: "bob-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getToolsList(toolRegistry),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return callTool(
    toolRegistry,
    name,
    (args ?? {}) as Record<string, unknown>,
    toolContext,
  );
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bob MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
