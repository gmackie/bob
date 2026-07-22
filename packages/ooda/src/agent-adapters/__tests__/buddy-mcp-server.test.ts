import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ToolHandlerError, type ToolHandler, type ToolName } from "@gmacko/ooda/buddy-tools";

import {
  BuddyMcpServer,
  extractToken,
  toMcpTool,
  toMcpToolCallResult,
} from "../buddy-mcp-server";
import type { ToolDescriptor } from "../tool-registry";

/**
 * A descriptor with a controllable handler. `name` is a real ToolName so the
 * descriptor type stays honest; schema + handler are bespoke per test.
 */
function makeDescriptor(
  overrides: Partial<ToolDescriptor> & { handler: (args: unknown) => Promise<unknown> },
): ToolDescriptor {
  return {
    name: "papers_search" satisfies ToolName,
    description: "search papers",
    argsSchema: z.object({ query: z.string() }),
    ...overrides,
    handler: overrides.handler as unknown as ToolHandler<ToolName>,
  };
}

// --- pure helpers ----------------------------------------------------------

describe("extractToken", () => {
  it("pulls the token out of a /mcp/<token> path", () => {
    expect(extractToken("/mcp/abc-123")).toBe("abc-123");
    expect(extractToken("/mcp/abc-123/")).toBe("abc-123");
    expect(extractToken("/mcp/abc-123?x=1")).toBe("abc-123");
  });

  it("returns null for non-matching paths", () => {
    expect(extractToken("/")).toBeNull();
    expect(extractToken("/mcp")).toBeNull();
    expect(extractToken("/mcp/")).toBeNull();
    expect(extractToken("/other/abc")).toBeNull();
  });
});

describe("toMcpTool", () => {
  it("maps a descriptor to name/description/inputSchema (JSON Schema)", () => {
    const tool = toMcpTool(
      makeDescriptor({
        argsSchema: z.object({ query: z.string(), limit: z.number().int().optional() }),
        handler: async () => ({}),
      }),
    );
    expect(tool.name).toBe("papers_search");
    expect(tool.description).toBe("search papers");
    expect(tool.inputSchema["type"]).toBe("object");
    const props = tool.inputSchema["properties"] as Record<string, unknown>;
    expect(props["query"]).toMatchObject({ type: "string" });
    expect(tool.inputSchema["required"]).toEqual(["query"]);
    // JSON Schema `$schema` is stripped for a clean MCP inputSchema.
    expect(tool.inputSchema["$schema"]).toBeUndefined();
  });
});

describe("toMcpToolCallResult", () => {
  it("serializes an ok ToolResult with isError=false", () => {
    const out = toMcpToolCallResult({ ok: true, data: { hits: 3 } });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content[0]!.text)).toEqual({ ok: true, data: { hits: 3 } });
  });

  it("marks isError=true for a failed ToolResult", () => {
    const out = toMcpToolCallResult({
      ok: false,
      error: { code: "X", message: "y", retryable: false },
    });
    expect(out.isError).toBe(true);
  });
});

// --- live HTTP server ------------------------------------------------------

describe("BuddyMcpServer over HTTP", () => {
  const servers: BuddyMcpServer[] = [];

  afterEach(async () => {
    for (const s of servers) await s.stop();
    servers.length = 0;
  });

  async function startServer(): Promise<BuddyMcpServer> {
    const server = new BuddyMcpServer();
    await server.start();
    servers.push(server);
    return server;
  }

  function rpc(url: string, method: string, params?: unknown, id: number | null = 1) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  }

  it("throws if a session is registered before start()", () => {
    const server = new BuddyMcpServer();
    expect(() => server.registerSession([])).toThrow(/start/);
  });

  it("404s an unknown session token", async () => {
    const server = await startServer();
    const { host, port } = server.address;
    const res = await rpc(`http://${host}:${port}/mcp/nope`, "tools/list");
    expect(res.status).toBe(404);
  });

  it("answers initialize with capabilities + serverInfo and a session id header", async () => {
    const server = await startServer();
    const { url } = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);

    const res = await rpc(url, "initialize", { protocolVersion: "2025-06-18" });
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const body = (await res.json()) as { result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities).toMatchObject({ tools: {} });
    expect(body.result.serverInfo.name).toBe("ooda-buddy-tools");
  });

  it("lists exactly the registered descriptors", async () => {
    const server = await startServer();
    const { url } = server.registerSession([
      makeDescriptor({
        name: "papers_search" satisfies ToolName,
        description: "search",
        argsSchema: z.object({ query: z.string() }),
        handler: async () => ({}),
      }),
      makeDescriptor({
        name: "inbox_list" satisfies ToolName,
        description: "list inbox",
        argsSchema: z.object({}),
        handler: async () => ({}),
      }),
    ]);

    const res = await rpc(url, "tools/list");
    const body = (await res.json()) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    expect(body.result.tools.map((t) => t.name)).toEqual(["papers_search", "inbox_list"]);
    expect(body.result.tools[0]!.inputSchema).toMatchObject({ type: "object" });
  });

  it("dispatches tools/call into the handler and returns an MCP result", async () => {
    const server = await startServer();
    const handler = vi.fn(async (args: unknown) => ({ echoed: args }));
    const { url } = server.registerSession([
      makeDescriptor({ argsSchema: z.object({ query: z.string() }), handler }),
    ]);

    const res = await rpc(url, "tools/call", {
      name: "papers_search",
      arguments: { query: "sleep" },
    });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(handler).toHaveBeenCalledWith({ query: "sleep" });
    expect(body.result.isError).toBe(false);
    expect(JSON.parse(body.result.content[0]!.text)).toEqual({
      ok: true,
      data: { echoed: { query: "sleep" } },
    });
  });

  it("returns an isError result for invalid tool args (no throw)", async () => {
    const server = await startServer();
    const handler = vi.fn(async () => ({}));
    const { url } = server.registerSession([
      makeDescriptor({ argsSchema: z.object({ query: z.string() }), handler }),
    ]);

    const res = await rpc(url, "tools/call", { name: "papers_search", arguments: { query: 42 } });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]!.text).error.code).toBe("INVALID_ARGS");
    expect(handler).not.toHaveBeenCalled();
  });

  it("surfaces a ToolHandlerError code with isError", async () => {
    const server = await startServer();
    const { url } = server.registerSession([
      makeDescriptor({
        handler: async () => {
          throw new ToolHandlerError("BUDGET_EXHAUSTED", "no budget", { retryable: false });
        },
      }),
    ]);

    const res = await rpc(url, "tools/call", { name: "papers_search", arguments: { query: "x" } });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]!.text).error.code).toBe("BUDGET_EXHAUSTED");
  });

  it("marks isError for an unknown tool name", async () => {
    const server = await startServer();
    const { url } = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);

    const res = await rpc(url, "tools/call", { name: "does_not_exist", arguments: {} });
    const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]!.text).error.code).toBe("UNKNOWN_TOOL");
  });

  it("202s a notification (notifications/initialized) with no body", async () => {
    const server = await startServer();
    const { url } = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("returns a JSON-RPC error for an unknown request method", async () => {
    const server = await startServer();
    const { url } = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);

    const res = await rpc(url, "no/such/method");
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32601);
  });

  it("returns a parse error for a malformed body", async () => {
    const server = await startServer();
    const { url } = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32700);
  });

  it("stops serving a session's tools after dispose()", async () => {
    const server = await startServer();
    const handle = server.registerSession([makeDescriptor({ handler: async () => ({}) })]);
    handle.dispose();

    const res = await rpc(handle.url, "tools/list");
    expect(res.status).toBe(404);
  });
});
