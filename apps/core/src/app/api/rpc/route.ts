import "server-only";
import type { Layer as LayerType } from "effect";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { getServerLayers } from "@/server/layers";
import { GmackoServerGroup, allHandlers } from "@/server/handlers";

// ---------------------------------------------------------------------------
// /api/rpc — single mount path for all 4 contract groups (Auth, Projects,
// Secrets, Agent).
//
// Layer composition (server side):
//   1. `RpcServer.layerHttp({ group, path, protocol: "http" })` — the RPC
//      transport for HTTP-with-NDJSON framing.
//   2. `Layer.provide(allHandlers)` — supplies the merged handler map for
//      the merged RpcGroup.
//   3. `Layer.provide(authMiddlewareLayer)` — supplies the AuthMiddleware
//      service the merged group declares (via `.middleware(AuthMiddleware)`).
//   4. `Layer.provide(RpcSerialization.layerNdjson)` — chunked-streaming
//      framing on the wire (`Content-Type: application/ndjson`). Same
//      framing as the 6F e2e test verifies — proven over `agent.sendTurn`.
//   5. `Layer.provide(runtimeLayer)` — every db-backed service the
//      handlers + middleware ultimately depend on (`Sessions`, `ApiKeys`,
//      `Tenancy`, `DeviceCodes`, `Projects`, `Secrets`, `AgentSession`,
//      etc.). Initialized once on first request by `server/layers.ts`.
//
// `HttpRouter.toWebHandler(appLayer)` returns `{ handler, dispose }`. The
// handler is a `(Request) => Promise<Response>` shape that drops cleanly
// into Next.js's Route Handler convention. We wire both GET and POST so
// the underlying `RpcServer` can route bidirectional + streaming requests.
// `dispose` is currently un-invoked at the route boundary — Next.js's
// route lifecycle does not surface a server-shutdown hook here. The
// resources held by the underlying Layer (PGlite handle, etc.) are
// process-wide singletons captured by `runtimeLayer`'s closure.
//
// Effect 4 beta drift: even though `RpcServer.layerHttp` provides
// `HttpServerRequest` per-request via the HTTP router and `AuthMiddleware`
// supplies `CurrentUser` at handler-call time, TypeScript surfaces both as
// residual layer requirements. `HttpRouter.toWebHandler` only accepts
// `HttpRouter | Request<...>` markers in `R`, so we cast through `unknown`
// to drop the spurious residuals. Runtime is correct: the protocol layer +
// middleware materialize these ambient services per request. Same
// composition shape used in the 6F e2e test, which passes against a real
// HTTP server.
// ---------------------------------------------------------------------------

async function createHandler() {
  const { authMiddlewareLayer, runtimeLayer } = await getServerLayers();
  const serverLayer = RpcServer.layerHttp({
    group: GmackoServerGroup,
    path: "/api/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(allHandlers),
    Layer.provide(authMiddlewareLayer),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(runtimeLayer),
  ) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

  return HttpRouter.toWebHandler(serverLayer);
}
let pending: ReturnType<typeof createHandler> | undefined;
async function handle(req: Request): Promise<Response> {
  pending ??= createHandler().catch((error) => {
    pending = undefined;
    throw error;
  });
  return (await pending).handler(req);
}
export const GET = handle;
export const POST = handle;
