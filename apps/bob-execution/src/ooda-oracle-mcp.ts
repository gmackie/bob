#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createOracleClient, type OracleQueryResult } from "./oracle-client";
import { readOracleConfig } from "./oracle-config";

export function renderToolText(result: OracleQueryResult): string {
  if (!result.chunks.length) return "No knowledge found in the OODA oracle for that query.";
  const lines = result.chunks.map((c, i) => {
    const title = c.sourceTitle?.trim() || "untitled source";
    return `${i + 1}. [${title}] ${c.content.trim().replace(/\s+/g, " ")}`;
  });
  return [`Oracle results (confidence ${result.confidence.toFixed(2)}):`, ...lines].join("\n");
}

async function main(): Promise<void> {
  const cfg = readOracleConfig();
  if (!cfg.enabled) {
    console.error("[ooda-oracle-mcp] OODA_API_URL / OODA_ORACLE_TOKEN not set; exiting.");
    process.exit(0);
  }
  const client = createOracleClient(cfg.apiUrl, cfg.token);
  const server = new McpServer({ name: "ooda-oracle", version: "0.1.0" });

  server.registerTool(
    "oracle_query",
    {
      description:
        "Query the OODA knowledge base (oracle) for documented patterns, prior decisions, and domain knowledge.",
      inputSchema: {
        question: z.string().min(1).describe("The natural-language question to ask the knowledge base."),
        topK: z.number().int().min(1).max(20).optional().describe("Max results (default 6)."),
        repo: z.string().optional().describe("Optional repo context to bias retrieval."),
      },
    },
    async ({ question, topK, repo }) => {
      try {
        const result = await client.oracle.query.query({
          task: "bob planning (live)", question, topK: topK ?? 6, repo,
        });
        return { content: [{ type: "text", text: renderToolText(result) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Oracle query failed: ${msg}` }], isError: true };
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

// Only run the server when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith("ooda-oracle-mcp.ts")) {
  void main();
}
