// Stub for ~/server/rpc in Cloudflare Workers.
// The Effect-RPC handler requires Node.js APIs and heavy dependencies
// (effect/unstable/rpc, effect/unstable/http, @gmacko/bob/contracts)
// that cannot be bundled for Workers. Returns 501 in edge mode.

export async function rpcHandler(_req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({ error: "Effect-RPC is not available in edge mode" }),
    {
      status: 501,
      headers: { "Content-Type": "application/json" },
    },
  );
}
