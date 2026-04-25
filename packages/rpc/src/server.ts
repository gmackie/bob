import type { Layer } from "effect";
import {
  Rpc,
  RpcGroup,
  RpcSerialization,
  RpcServer,
} from "effect/unstable/rpc";
import { HttpRouter } from "effect/unstable/http";

// Build a Layer that serves a given RpcGroup over HTTP.
// Apps compose this with their auth/db/realtime layers and must provide
// HttpRouter.HttpRouter, RpcSerialization.RpcSerialization (see
// serializationLayer below), and handler layers for every rpc in the group.
export const makeRpcServerLayer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | RpcSerialization.RpcSerialization
  | Rpc.ToHandler<Rpcs>
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>
> =>
  RpcServer.layerHttp({
    group,
    path: "/rpc",
    protocol: "http",
  });

/**
 * Default serialization Layer for the gmacko RPC server.
 *
 * Phase 6H Task 8 — the canonical e2e test (`@gmacko/client`'s
 * `e2e.test.ts`) and the client SDK (`@gmacko/client/src/internal/runtime`)
 * have moved to `RpcSerialization.layerNdjson` for true chunked streaming
 * of `agent.sendTurn`. When 6K wires this `makeRpcServerLayer` into the
 * real Next.js handler, swap this default to `layerNdjson` so streaming
 * RPCs participate in chunked transport end-to-end. Both layers are
 * interchangeable `Layer.Layer<RpcSerialization>` values per
 * `effect/unstable/rpc/RpcSerialization.d.ts:60,70` — drop-in swap.
 *
 * Left on `layerJson` until 6K so any current consumer of this barrel
 * (none in-repo today) keeps the previous behavior until the cutover.
 */
export const serializationLayer = RpcSerialization.layerJson;
