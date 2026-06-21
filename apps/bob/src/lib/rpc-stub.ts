// Stub for ~/server/rpc in Cloudflare Workers.
// The Effect-RPC handler requires Node.js APIs and heavy dependencies
// (effect/unstable/rpc, effect/unstable/http, @gmacko/bob/contracts) that
// cannot be bundled for Workers.
//
// Task 4d: when BOB_RPC_ORIGIN is configured, the edge forwards /api/rpc to the
// Node bob-server that actually hosts Effect-RPC (see apps/bob-server, gated by
// BOB_SERVER_HOST_RPC). Without it, returns 501 — the prior behavior.

export async function rpcHandler(req: Request): Promise<Response> {
  const origin = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.BOB_RPC_ORIGIN;

  if (origin) {
    const url = new URL(req.url);
    const target = `${origin.replace(/\/$/, "")}${url.pathname}${url.search}`;
    // Preserve method, headers, and body; forward auth cookies/bearer through.
    return fetch(target, {
      method: req.method,
      headers: req.headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.arrayBuffer(),
    });
  }

  return new Response(
    JSON.stringify({ error: "Effect-RPC is not available in edge mode" }),
    {
      status: 501,
      headers: { "Content-Type": "application/json" },
    },
  );
}
