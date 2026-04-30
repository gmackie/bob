import "server-only";
import type { Layer as LayerType } from "effect";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";

import { AuthMiddleware } from "@gmacko/core/auth";

import { runtimeLayer, authMiddlewareLayer } from "./layers.js";

// ---------------------------------------------------------------------------
// Bob Effect-RPC server — mounts at /api/rpc alongside the existing /api/trpc.
//
// Starts with a single `health` probe RPC behind `AuthMiddleware`. Groups and
// handlers expand as contracts land in Phases B/C/D.
// ---------------------------------------------------------------------------

const HealthRpc = Rpc.make("health", {
  payload: Schema.Void,
  success: Schema.Struct({ ok: Schema.Boolean }),
});

const BobRpcGroup = RpcGroup.make(HealthRpc).middleware(AuthMiddleware);

const handlers = BobRpcGroup.toLayer({
  health: () => Effect.succeed({ ok: true }),
});

const serverLayer = RpcServer.layerHttp({
  group: BobRpcGroup,
  path: "/api/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(handlers),
  Layer.provide(authMiddlewareLayer),
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(runtimeLayer),
) as unknown as LayerType.Layer<never, never, HttpRouter.HttpRouter>;

const { handler } = HttpRouter.toWebHandler(serverLayer);

export { handler as rpcHandler };
