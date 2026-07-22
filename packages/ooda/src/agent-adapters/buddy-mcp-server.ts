// In-process HTTP MCP server exposing the gated buddy-tool set to Grok.
//
// This is the CORRECT seam for agent-invoked tools. Grok Build's ACP client
// does NOT send agent->client `tools/call` requests; instead it connects OUT
// to the MCP servers listed in `session/new`'s `mcpServers` and speaks
// standard MCP (`initialize` / `tools/list` / `tools/call`) to them. Verified
// live against grok 0.2.106 (model grok-4.5): advertising an http MCP server
// makes Grok emit `_x.ai/mcp_initialized {mcpToolCount:N}` and then call
// `tools/call` on the server mid-session.
//
// Transport: MCP "Streamable HTTP". Grok (protocolVersion 2025-06-18) POSTs
// each JSON-RPC message to the endpoint with `Accept: application/json,
// text/event-stream`; we answer each request inline as `application/json`
// (the spec's simple mode — no server-initiated streaming needed for a pure
// tool server). Grok also opens a `GET` SSE stream after `initialize`; we
// hold it open and push nothing.
//
// Why in-process (vs a stdio subprocess): the buddy-tool handlers need the
// live tRPC `HandlerContext` + the mutable per-session budget, both of which
// live in the runner process. Keeping the MCP server in-process lets
// `tools/call` flow straight into `dispatchBuddyTool` against the exact
// descriptor set the session executor already built + gated — no IPC, no
// auth re-plumbing, no second process. Each runner session registers its own
// gated descriptor set under an unguessable path token; the server routes by
// that token, so one shared listener serves every concurrent session.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type ToolResult } from "@gmacko/ooda/buddy-tools";

import { dispatchBuddyTool } from "./tool-dispatcher";
import type { ToolDescriptor } from "./tool-registry";

/** MCP protocol version we default to when the client doesn't send one. */
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

/** Advertised MCP server version (independent of the buddy-tools schema rev). */
const SERVER_VERSION = "1.0.0";

/** Reject request bodies larger than this (defensive; tool args are tiny). */
const MAX_BODY_BYTES = 1_000_000;

/**
 * An `mcpServers` entry for `session/new`, in the http transport shape Grok
 * expects: `{ type, name, url, headers }`. Verified live — the stdio shape is
 * `{ name, command, args, env }`; this is the http variant.
 */
export interface McpServerConfig {
  type: "http";
  name: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
}

/** Handle for one session's tool exposure. Dispose to stop serving its tools. */
export interface BuddyMcpSessionHandle {
  /** Per-session MCP endpoint URL to advertise via `session/new.mcpServers`. */
  url: string;
  /** The ready-to-advertise `mcpServers` entry for this session. */
  config: McpServerConfig;
  /** Unregister this session's tools. Idempotent. */
  dispose: () => void;
}

export interface BuddyMcpServerOptions {
  /** Bind host. Defaults to loopback (Grok runs on the same machine). */
  host?: string;
  /** Server name advertised in `serverInfo` and the `mcpServers` entry. */
  serverName?: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** MCP tool descriptor shape returned by `tools/list`. */
interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP `tools/call` result envelope. */
interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

/**
 * In-process HTTP MCP server. Start it once per runner; register a gated
 * descriptor set per session with {@link registerSession}.
 */
export class BuddyMcpServer {
  private server: Server | null = null;
  private boundPort = 0;
  private readonly host: string;
  private readonly serverName: string;
  /** token -> the gated descriptor set exposed for that session. */
  private readonly sessions = new Map<string, readonly ToolDescriptor[]>();

  constructor(options: BuddyMcpServerOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.serverName = options.serverName ?? "ooda-buddy-tools";
  }

  /** Bind the HTTP listener on an ephemeral port. Idempotent. */
  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => this.handleRequest(req, res));
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once("error", onError);
      server.listen(0, this.host, () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
    const addr = server.address();
    if (addr && typeof addr === "object") this.boundPort = addr.port;
    this.server = server;
  }

  /** Close the listener and drop all session registrations. */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.sessions.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** The bound `{ host, port }`. Port is 0 until {@link start} resolves. */
  get address(): { host: string; port: number } {
    return { host: this.host, port: this.boundPort };
  }

  /**
   * Expose a gated descriptor set for one session and return the endpoint to
   * advertise. Dispose the handle when the session ends so its tools stop
   * being served.
   */
  registerSession(descriptors: readonly ToolDescriptor[]): BuddyMcpSessionHandle {
    if (!this.server) {
      throw new Error("BuddyMcpServer.registerSession called before start()");
    }
    const token = randomUUID();
    this.sessions.set(token, descriptors);
    const url = `http://${this.host}:${this.boundPort}/mcp/${token}`;
    const config: McpServerConfig = {
      type: "http",
      name: this.serverName,
      url,
      headers: [],
    };
    let disposed = false;
    return {
      url,
      config,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.sessions.delete(token);
      },
    };
  }

  // --- HTTP plumbing -------------------------------------------------------

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const token = extractToken(req.url ?? "");
    const descriptors = token ? this.sessions.get(token) : undefined;
    if (!token || !descriptors) {
      res.writeHead(404).end();
      return;
    }

    if (req.method === "GET") {
      // Streamable HTTP's optional server->client SSE stream. Grok opens this
      // after `initialize`; we never push over it (responses go inline on
      // POST), but hold it open rather than 405 so the client stays happy.
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": ok\n\n");
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let body = "";
    let aborted = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES && !aborted) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      void this.handlePost(token, descriptors, body, res);
    });
  }

  private async handlePost(
    token: string,
    descriptors: readonly ToolDescriptor[],
    body: string,
    res: ServerResponse,
  ): Promise<void> {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(body) as JsonRpcMessage;
    } catch {
      writeJson(res, 400, token, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    const response = await this.route(descriptors, message);
    if (response === null) {
      // Notification (e.g. `notifications/initialized`) — nothing to return.
      res.writeHead(202, { "Mcp-Session-Id": token }).end();
      return;
    }
    writeJson(res, 200, token, response);
  }

  private async route(
    descriptors: readonly ToolDescriptor[],
    message: JsonRpcMessage,
  ): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: protocolVersionOf(message.params),
            capabilities: { tools: {} },
            serverInfo: { name: this.serverName, version: SERVER_VERSION },
          },
        };
      case "notifications/initialized":
        return null;
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: descriptors.map(toMcpTool) },
        };
      case "tools/call": {
        const params = (message.params ?? {}) as { name?: string; arguments?: unknown };
        const toolName = typeof params.name === "string" ? params.name : "";
        const result = await dispatchBuddyTool(descriptors, toolName, params.arguments);
        return { jsonrpc: "2.0", id, result: toMcpToolCallResult(result) };
      }
      default:
        // Unknown notification (no id) -> ignore; unknown request -> error.
        if (message.id === undefined || message.id === null) return null;
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${message.method ?? ""}` },
        };
    }
  }
}

// --- pure helpers (exported for unit tests) --------------------------------

/** Extract the session token from a `/mcp/<token>` path. */
export function extractToken(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const match = /^\/mcp\/([^/]+)\/?$/.exec(path);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Echo the client's requested protocol version, else our default. */
function protocolVersionOf(params: unknown): string {
  if (params && typeof params === "object" && "protocolVersion" in params) {
    const v = (params as { protocolVersion?: unknown }).protocolVersion;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

/** Map a buddy-tool descriptor to an MCP `tools/list` entry. */
export function toMcpTool(descriptor: ToolDescriptor): McpTool {
  return {
    name: descriptor.name,
    description: descriptor.description,
    inputSchema: toInputSchema(descriptor.argsSchema),
  };
}

/**
 * Convert a Zod args schema to a JSON Schema for MCP `inputSchema`. Uses the
 * input view (defaults make fields optional). Falls back to a permissive
 * object schema if a schema can't be represented, so one exotic tool can't
 * break the whole `tools/list`.
 */
function toInputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
    delete json["$schema"];
    if (json["type"] === undefined) json["type"] = "object";
    return json;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

/** Shape a buddy `ToolResult` into the MCP tool-result envelope. */
export function toMcpToolCallResult(result: ToolResult): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: !result.ok,
  };
}

function writeJson(
  res: ServerResponse,
  status: number,
  token: string,
  payload: JsonRpcResponse,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Mcp-Session-Id": token,
  });
  res.end(body);
}
