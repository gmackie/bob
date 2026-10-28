import "server-only";
import { db } from "@bob/db/client";
import { checkRateLimit, rateLimitResponse } from "@bob/api/rate-limit";
import { auth } from "~/auth/server";
import { makeOAuthStore } from "./store";
import { json, makeOAuth } from "./oauth";
import { makeTools, makeWorkspaceIdentity } from "./tools";
import { makeMcpTransport } from "./transport";

// A configured public origin prevents Host/forwarded-header poisoning of
// resource audiences and discovery metadata. Never derive it from the request.
const origin = new URL(
  process.env.FRONTEND_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:5173",
).origin;
const allowedOrigins = (process.env.BOB_MCP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const identity = makeWorkspaceIdentity(db, async (request) => {
  // OAuth consent must use an interactive session, never API keys/dev fallback.
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const session = await auth.api.getSession({ headers });
  return session ? { userId: session.user.id } : null;
});
const oauth = makeOAuth({ origin, store: makeOAuthStore(db), identity });
const transport = makeMcpTransport(
  oauth,
  makeTools(db, identity),
  allowedOrigins,
);
export async function mcpRoute(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const requestOrigin = request.headers.get("origin");
  const corsOrigin =
    requestOrigin && [origin, ...allowedOrigins].includes(requestOrigin)
      ? requestOrigin
      : null;
  let response: Response;
  if (request.method === "OPTIONS")
    response = new Response(null, { status: 204 });
  else {
    const limit = checkRateLimit(request, {
      profile: path === "/mcp" ? "authenticated" : "device",
    });
    if (limit?.limited) response = rateLimitResponse(limit);
    else {
      try {
        response = await (path === "/mcp"
          ? transport(request)
          : oauth.handle(request));
      } catch {
        response = json({ error: "server_error" }, 500);
      }
    }
  }
  const discovery = path.startsWith("/.well-known/");
  if (corsOrigin || discovery) {
    response.headers.set(
      "Access-Control-Allow-Origin",
      discovery ? "*" : corsOrigin!,
    );
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id",
    );
    response.headers.set(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, MCP-Protocol-Version, MCP-Session-Id",
    );
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
