import type { makeOAuth } from "./oauth";
import { json, readBody, OAuthError } from "./oauth";
import type { McpToolService } from "./tools";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const result = (id: string | number, value: unknown) =>
  json({ jsonrpc: "2.0", id, result: value });
const error = (id: unknown, code: number, message: string, status = 200) =>
  json({ jsonrpc: "2.0", id, error: { code, message } }, status);
export function makeMcpTransport(
  oauth: ReturnType<typeof makeOAuth>,
  tools: McpToolService,
  allowedOrigins: string[] = [],
) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    if (
      origin &&
      ![new URL(oauth.resource).origin, ...allowedOrigins].includes(origin)
    )
      return json({ error: "Forbidden origin" }, 403);
    const grant = await oauth.authenticate(request);
    if (!grant)
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${new URL(oauth.resource).origin}/.well-known/oauth-protected-resource/mcp", scope="bob:read"`,
      });
    // Stateless Streamable HTTP: no server-initiated messages or sessions.
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const version = request.headers.get("mcp-protocol-version");
    if (version && !VERSIONS.includes(version))
      return error(null, -32600, "Unsupported protocol version", 400);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return error(null, -32600, "Expected application/json", 415);
    const accepts = request.headers.get("accept") ?? "";
    if (
      !accepts.includes("application/json") ||
      !accepts.includes("text/event-stream")
    )
      return error(
        null,
        -32600,
        "Accept must include application/json and text/event-stream",
        406,
      );
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch (e) {
      return e instanceof OAuthError
        ? error(null, -32600, e.message, e.status)
        : error(null, -32700, "Parse error", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return error(null, -32600, "Expected one JSON-RPC message", 400);
    const message = body as Record<string, unknown>;
    const id = message.id;
    if (
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      (id !== undefined && typeof id !== "string" && typeof id !== "number") ||
      (message.params !== undefined &&
        (!message.params ||
          typeof message.params !== "object" ||
          Array.isArray(message.params)))
    )
      return error(null, -32600, "Invalid JSON-RPC message", 400);
    if (id === undefined) {
      if (!message.method.startsWith("notifications/"))
        return error(null, -32600, "Requests need an id", 400);
      return new Response(null, { status: 202 });
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    switch (message.method) {
      case "initialize":
        if (
          typeof params.protocolVersion !== "string" ||
          !params.clientInfo ||
          typeof params.clientInfo !== "object" ||
          !params.capabilities ||
          typeof params.capabilities !== "object"
        )
          return error(id, -32602, "Invalid initialization parameters");
        return result(id, {
          protocolVersion: VERSIONS.includes(params.protocolVersion)
            ? params.protocolVersion
            : VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "bob", version: "1.0.0" },
          instructions:
            "Tools are restricted to the workspace selected during OAuth consent. Use bob_list_projects to discover projects.",
        });
      case "ping":
        return result(id, {});
      case "tools/list":
        return result(id, { tools: tools.list(grant) });
      case "tools/call": {
        if (
          typeof params.name !== "string" ||
          (params.arguments !== undefined &&
            (!params.arguments ||
              typeof params.arguments !== "object" ||
              Array.isArray(params.arguments)))
        )
          return error(id, -32602, "Expected tool name and arguments object");
        try {
          const value = await tools.call(
            grant,
            params.name,
            params.arguments ?? {},
          );
          return result(id, {
            content: [{ type: "text", text: JSON.stringify(value) }],
            structuredContent:
              value && typeof value === "object" && !Array.isArray(value)
                ? value
                : { result: value },
            isError: false,
          });
        } catch {
          // Never return driver errors, stack traces, tokens or internal paths.
          return result(id, {
            content: [
              {
                type: "text",
                text: "Tool call failed. Check the tool arguments, granted scopes, and workspace access.",
              },
            ],
            isError: true,
          });
        }
      }
      default:
        return error(id, -32601, "Method not found");
    }
  };
}
