import { mcpRoute } from "~/server/mcp";

function discovery(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace("/api/mcp-discovery/", "/.well-known/");
  return mcpRoute(new Request(url, request));
}
export { discovery as GET, discovery as OPTIONS };
